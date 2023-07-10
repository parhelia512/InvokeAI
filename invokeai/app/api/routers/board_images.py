from fastapi import Body, HTTPException, Path, Query
from fastapi.routing import APIRouter

from invokeai.app.models.image import (AddManyImagesToBoardResult,
                                       RemoveManyImagesFromBoardResult)
from invokeai.app.services.image_record_storage import OffsetPaginatedResults
from invokeai.app.services.models.image_record import ImageDTO

from ..dependencies import ApiDependencies

board_images_router = APIRouter(prefix="/v1/board_images", tags=["boards"])


@board_images_router.post(
    "/",
    operation_id="create_board_image",
    responses={
        201: {"description": "The image was added to a board successfully"},
    },
    status_code=201,
)
async def create_board_image(
    board_id: str = Body(description="The id of the board to add to"),
    image_name: str = Body(description="The name of the image to add"),
):
    """Creates a board_image"""
    try:
        result = ApiDependencies.invoker.services.board_images.add_image_to_board(
            board_id=board_id, image_name=image_name
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to add to board")


@board_images_router.delete(
    "/",
    operation_id="remove_board_image",
    responses={
        201: {"description": "The image was removed from the board successfully"},
    },
    status_code=201,
)
async def remove_board_image(
    image_name: str = Body(
        description="The name of the image to remove from its board"
    ),
):
    """Deletes a board_image"""
    try:
        result = ApiDependencies.invoker.services.board_images.remove_image_from_board(
            image_name=image_name
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail="Failed to update board")


@board_images_router.get(
    "/{board_id}",
    operation_id="list_board_images",
    response_model=OffsetPaginatedResults[ImageDTO],
)
async def list_board_images(
    board_id: str = Path(description="The id of the board"),
    offset: int = Query(default=0, description="The page offset"),
    limit: int = Query(default=10, description="The number of boards per page"),
) -> OffsetPaginatedResults[ImageDTO]:
    """Gets a list of images for a board"""

    results = ApiDependencies.invoker.services.board_images.get_images_for_board(
        board_id,
    )
    return results


@board_images_router.patch(
    "/{board_id}/images",
    operation_id="create_multiple_board_images",
    responses={
        201: {"description": "The images were added to the board successfully"},
    },
    status_code=201,
)
async def create_multiple_board_images(
    board_id: str = Path(description="The id of the board"),
    image_names: list[str] = Body(
        description="The names of the images to add to the board"
    ),
) -> AddManyImagesToBoardResult:
    """Add many images to a board"""

    results = ApiDependencies.invoker.services.board_images.add_many_images_to_board(
        board_id, image_names
    )
    return results


@board_images_router.post(
    "/images",
    operation_id="delete_multiple_board_images",
    responses={
        201: {"description": "The images were removed from their boards successfully"},
    },
    status_code=201,
)
async def delete_multiple_board_images(
    image_names: list[str] = Body(
        description="The names of the images to remove from their boards, if they have one"
    ),
) -> RemoveManyImagesFromBoardResult:
    """Remove many images from their boards, if they have one"""

    results = (
        ApiDependencies.invoker.services.board_images.remove_many_images_from_board(
            image_names
        )
    )
    return results
