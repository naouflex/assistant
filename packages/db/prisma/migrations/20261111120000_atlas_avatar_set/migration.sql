-- Atlas rename: the brand mascot set was stored as 'rakazo'. Rows keep their
-- avatar; only the set's identifier changes. resolveBotAvatarSet still reads the
-- legacy value, so rows written by an older build stay on the same renderer.
UPDATE "bots" SET "avatarSet" = 'atlas' WHERE "avatarSet" = 'rakazo';
