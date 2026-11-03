-- A plan belongs to one chat. Older rows stay null until a later save sets the chat.
ALTER TABLE "scratchpad_items" ADD COLUMN "threadId" TEXT;

CREATE INDEX "scratchpad_items_spaceId_botId_threadId_status_idx" ON "scratchpad_items"("spaceId", "botId", "threadId", "status");
