import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { SafeUser } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CommentsService } from './comments.service';
import { AddReactionDto } from './dto/add-reaction.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

const MAX_ATTACHMENT_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

// Sprint 5C (Comments). videos/:videoId/comments for create/list (matches
// workspace/project.controller.ts's "nest under the parent resource"
// convention); comments/:id/* for everything that only needs the comment's
// own id.
@Controller()
@UseGuards(JwtAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post('videos/:videoId/comments')
  create(
    @CurrentUser() user: SafeUser,
    @Param('videoId') videoId: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.commentsService.create(user.id, videoId, dto);
  }

  @Get('videos/:videoId/comments')
  list(@CurrentUser() user: SafeUser, @Param('videoId') videoId: string) {
    return this.commentsService.list(user.id, videoId);
  }

  @Patch('comments/:id')
  update(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: UpdateCommentDto) {
    return this.commentsService.update(user.id, id, dto.body);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async remove(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.commentsService.remove(user.id, id);
  }

  @Post('comments/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.commentsService.setResolved(user.id, id, true);
  }

  @Post('comments/:id/unresolve')
  @HttpCode(200)
  unresolve(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    return this.commentsService.setResolved(user.id, id, false);
  }

  @Post('comments/:id/reactions')
  addReaction(@CurrentUser() user: SafeUser, @Param('id') id: string, @Body() dto: AddReactionDto) {
    return this.commentsService.addReaction(user.id, id, dto.emoji);
  }

  // 200, not 204 - unlike remove() above, this DELETE returns the updated
  // CommentDto (reaction counts) so the client can refresh without a
  // follow-up GET, so it can't be a body-less 204 response.
  @Delete('comments/:id/reactions/:emoji')
  @HttpCode(200)
  removeReaction(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Param('emoji') emoji: string,
  ) {
    return this.commentsService.removeReaction(user.id, id, decodeURIComponent(emoji));
  }

  @Post('comments/:id/attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_SIZE_BYTES } }))
  addAttachment(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @UploadedFile(new ParseFilePipeBuilder().build({ fileIsRequired: true }))
    file: Express.Multer.File,
  ) {
    return this.commentsService.addAttachment(user.id, id, file);
  }

  @Get('comments/:id/attachments/:attachmentId')
  async downloadAttachment(
    @CurrentUser() user: SafeUser,
    @Param('attachmentId') attachmentId: string,
    @Res() res: Response,
  ) {
    const attachment = await this.commentsService.getAttachmentOrThrow(user.id, attachmentId);
    const stream = await getObjectStream(attachment.storageKey);
    res.setHeader('Content-Type', attachment.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    stream.pipe(res);
  }
}
