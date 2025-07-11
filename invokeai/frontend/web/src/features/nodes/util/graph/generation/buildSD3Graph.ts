import { logger } from 'app/logging/logger';
import { getPrefixedId } from 'features/controlLayers/konva/util';
import { selectMainModelConfig, selectParamsSlice } from 'features/controlLayers/store/paramsSlice';
import { selectCanvasMetadata, selectCanvasSlice } from 'features/controlLayers/store/selectors';
import { addImageToImage } from 'features/nodes/util/graph/generation/addImageToImage';
import { addInpaint } from 'features/nodes/util/graph/generation/addInpaint';
import { addNSFWChecker } from 'features/nodes/util/graph/generation/addNSFWChecker';
import { addOutpaint } from 'features/nodes/util/graph/generation/addOutpaint';
import { addTextToImage } from 'features/nodes/util/graph/generation/addTextToImage';
import { addWatermarker } from 'features/nodes/util/graph/generation/addWatermarker';
import { Graph } from 'features/nodes/util/graph/generation/Graph';
import {
  getSizes,
  selectCanvasOutputFields,
  selectPresetModifiedPrompts,
} from 'features/nodes/util/graph/graphBuilderUtils';
import type { GraphBuilderArg, GraphBuilderReturn, ImageOutputNodes } from 'features/nodes/util/graph/types';
import type { Invocation } from 'services/api/types';
import type { Equals } from 'tsafe';
import { assert } from 'tsafe';

const log = logger('system');

export const buildSD3Graph = async (arg: GraphBuilderArg): Promise<GraphBuilderReturn> => {
  const { generationMode, state } = arg;
  log.debug({ generationMode }, 'Building SD3 graph');

  const model = selectMainModelConfig(state);
  assert(model, 'No model found in state');
  assert(model.base === 'sd-3');

  const params = selectParamsSlice(state);
  const canvas = selectCanvasSlice(state);

  const { bbox } = canvas;

  const {
    cfgScale: cfg_scale,
    seed,
    steps,
    vae,
    t5EncoderModel,
    clipLEmbedModel,
    clipGEmbedModel,
    optimizedDenoisingEnabled,
    img2imgStrength,
  } = params;

  const { originalSize, scaledSize } = getSizes(bbox);
  const { positivePrompt, negativePrompt } = selectPresetModifiedPrompts(state);

  const g = new Graph(getPrefixedId('sd3_graph'));
  const modelLoader = g.addNode({
    type: 'sd3_model_loader',
    id: getPrefixedId('sd3_model_loader'),
    model,
    t5_encoder_model: t5EncoderModel,
    clip_l_model: clipLEmbedModel,
    clip_g_model: clipGEmbedModel,
    vae_model: vae,
  });
  const posCond = g.addNode({
    type: 'sd3_text_encoder',
    id: getPrefixedId('pos_cond'),
    prompt: positivePrompt,
  });

  const negCond = g.addNode({
    type: 'sd3_text_encoder',
    id: getPrefixedId('neg_cond'),
    prompt: negativePrompt,
  });

  const denoise = g.addNode({
    type: 'sd3_denoise',
    id: getPrefixedId('sd3_denoise'),
    cfg_scale,
    steps,
    denoising_start: 0,
    denoising_end: 1,
    width: scaledSize.width,
    height: scaledSize.height,
  });
  const l2i = g.addNode({
    type: 'sd3_l2i',
    id: getPrefixedId('l2i'),
  });

  g.addEdge(modelLoader, 'transformer', denoise, 'transformer');
  g.addEdge(modelLoader, 'clip_l', posCond, 'clip_l');
  g.addEdge(modelLoader, 'clip_l', negCond, 'clip_l');
  g.addEdge(modelLoader, 'clip_g', posCond, 'clip_g');
  g.addEdge(modelLoader, 'clip_g', negCond, 'clip_g');
  g.addEdge(modelLoader, 't5_encoder', posCond, 't5_encoder');
  g.addEdge(modelLoader, 't5_encoder', negCond, 't5_encoder');

  g.addEdge(posCond, 'conditioning', denoise, 'positive_conditioning');
  g.addEdge(negCond, 'conditioning', denoise, 'negative_conditioning');

  g.addEdge(denoise, 'latents', l2i, 'latents');

  g.upsertMetadata({
    cfg_scale,
    width: originalSize.width,
    height: originalSize.height,
    positive_prompt: positivePrompt,
    negative_prompt: negativePrompt,
    model: Graph.getModelMetadataField(model),
    seed,
    steps,
    vae: vae ?? undefined,
  });
  g.addEdge(modelLoader, 'vae', l2i, 'vae');

  let denoising_start: number;
  if (optimizedDenoisingEnabled) {
    // We rescale the img2imgStrength (with exponent 0.2) to effectively use the entire range [0, 1] and make the scale
    // more user-friendly for SD3.5. Without this, most of the 'change' is concentrated in the high denoise strength
    // range (>0.9).
    denoising_start = 1 - img2imgStrength ** 0.2;
  } else {
    denoising_start = 1 - img2imgStrength;
  }

  let canvasOutput: Invocation<ImageOutputNodes> = l2i;

  if (generationMode === 'txt2img') {
    canvasOutput = addTextToImage({ g, l2i, originalSize, scaledSize });
    g.upsertMetadata({ generation_mode: 'sd3_txt2img' });
  } else if (generationMode === 'img2img') {
    canvasOutput = await addImageToImage({
      g,
      manager: arg.canvasManager,
      l2i,
      i2lNodeType: 'sd3_i2l',
      denoise,
      vaeSource: modelLoader,
      originalSize,
      scaledSize,
      bbox,
      denoising_start,
      fp32: false,
    });
    g.upsertMetadata({ generation_mode: 'sd3_img2img' });
  } else if (generationMode === 'inpaint') {
    canvasOutput = await addInpaint({
      state,
      g,
      manager: arg.canvasManager,
      l2i,
      i2lNodeType: 'sd3_i2l',
      denoise,
      vaeSource: modelLoader,
      modelLoader,
      originalSize,
      scaledSize,
      denoising_start,
      fp32: false,
      seed,
    });
    g.upsertMetadata({ generation_mode: 'sd3_inpaint' });
  } else if (generationMode === 'outpaint') {
    canvasOutput = await addOutpaint({
      state,
      g,
      manager: arg.canvasManager,
      l2i,
      i2lNodeType: 'sd3_i2l',
      denoise,
      vaeSource: modelLoader,
      modelLoader,
      originalSize,
      scaledSize,
      denoising_start,
      fp32: false,
      seed,
    });
    g.upsertMetadata({ generation_mode: 'sd3_outpaint' });
  } else {
    assert<Equals<typeof generationMode, never>>(false);
  }

  if (state.system.shouldUseNSFWChecker) {
    canvasOutput = addNSFWChecker(g, canvasOutput);
  }

  if (state.system.shouldUseWatermarker) {
    canvasOutput = addWatermarker(g, canvasOutput);
  }

  g.upsertMetadata(selectCanvasMetadata(state));

  g.updateNode(canvasOutput, selectCanvasOutputFields(state));

  g.setMetadataReceivingNode(canvasOutput);
  return {
    g,
    seedFieldIdentifier: { nodeId: denoise.id, fieldName: 'seed' },
    positivePromptFieldIdentifier: { nodeId: posCond.id, fieldName: 'prompt' },
  };
};
