-- A bot can be pinned to one of its owner's paired computers. Null keeps the newest connected one.
ALTER TABLE "bots" ADD COLUMN "userDeviceId" TEXT;
