import { objectEquals } from '@observ33r/object-equals';
import { createSelector } from '@reduxjs/toolkit';
import { useAppDispatch, useAppSelector } from 'app/store/storeHooks';
import { useInputFieldTemplateOrThrow } from 'features/nodes/hooks/useInputFieldTemplateOrThrow';
import { fieldValueReset } from 'features/nodes/store/nodesSlice';
import { selectNodesSlice } from 'features/nodes/store/selectors';
import { isInvocationNode } from 'features/nodes/types/invocation';
import { useCallback, useMemo } from 'react';

export const useInputFieldDefaultValue = (nodeId: string, fieldName: string) => {
  const dispatch = useAppDispatch();

  const fieldTemplate = useInputFieldTemplateOrThrow(nodeId, fieldName);
  const selectIsChanged = useMemo(
    () =>
      createSelector(selectNodesSlice, (nodes) => {
        const node = nodes.nodes.find((node) => node.id === nodeId);
        if (!isInvocationNode(node)) {
          return;
        }
        const value = node.data.inputs[fieldName]?.value;
        return !objectEquals(value, fieldTemplate.default);
      }),
    [fieldName, fieldTemplate.default, nodeId]
  );
  const isValueChanged = useAppSelector(selectIsChanged);

  const resetToDefaultValue = useCallback(() => {
    dispatch(fieldValueReset({ nodeId, fieldName, value: fieldTemplate.default }));
  }, [dispatch, fieldName, fieldTemplate.default, nodeId]);

  return { defaultValue: fieldTemplate.default, isValueChanged, resetToDefaultValue };
};
