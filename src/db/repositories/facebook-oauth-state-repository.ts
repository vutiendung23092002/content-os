import "server-only";

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { facebookOauthStates } from "@/db/schema";

export class FacebookOauthStateRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async create(input: {
    stateHash: string;
    appUserId: string;
    redirectPath: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.database
      .delete(facebookOauthStates)
      .where(lt(facebookOauthStates.expiresAt, new Date()));
    await this.database.insert(facebookOauthStates).values(input);
  }

  async consume(input: { stateHash: string; appUserId: string; now: Date }) {
    const [state] = await this.database
      .update(facebookOauthStates)
      .set({ consumedAt: input.now })
      .where(
        and(
          eq(facebookOauthStates.stateHash, input.stateHash),
          eq(facebookOauthStates.appUserId, input.appUserId),
          isNull(facebookOauthStates.consumedAt),
          gt(facebookOauthStates.expiresAt, input.now),
        ),
      )
      .returning();
    return state;
  }
}
