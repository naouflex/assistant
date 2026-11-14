import type { PrismaClient } from "@atlas/db";
import { describe, expect, it, vi } from "vitest";
import { routineNotice } from "./run-notifications.js";

function prismaWith(routine: { name: string; crons: string[] } | null) {
  const findUnique = vi.fn(async () => routine);
  return { prisma: { routine: { findUnique } } as unknown as PrismaClient, findUnique };
}

describe("routineNotice", () => {
  it("announces a one-time reminder under its name, as urgent", async () => {
    const { prisma } = prismaWith({ name: "Call the bank", crons: ["@once"] });
    await expect(routineNotice(prisma, { trigger: "routine", routineId: "r1" })).resolves.toEqual({
      name: "Call the bank",
      urgent: true,
    });
  });

  it("names a repeating routine without making it urgent", async () => {
    const { prisma } = prismaWith({ name: "Morning digest", crons: ["0 8 * * *"] });
    await expect(routineNotice(prisma, { trigger: "routine", routineId: "r1" })).resolves.toEqual({
      name: "Morning digest",
      urgent: false,
    });
  });

  it("does not look anything up for other runs", async () => {
    const { prisma, findUnique } = prismaWith(null);
    await expect(routineNotice(prisma, { trigger: "user", routineId: null })).resolves.toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
