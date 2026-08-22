import "server-only";
import { and, eq } from "drizzle-orm";
import type { DatabaseExecutor } from "@/db/client";
import { userPageAssignments } from "@/db/schema";

export type UserPageAssignmentRecord = typeof userPageAssignments.$inferSelect;

export class UserPageAssignmentRepository {
  constructor(private readonly database: DatabaseExecutor) {}

  async listForUser(userId: string): Promise<UserPageAssignmentRecord[]> {
    return this.database
      .select()
      .from(userPageAssignments)
      .where(eq(userPageAssignments.userId, userId));
  }

  async listAll(): Promise<UserPageAssignmentRecord[]> {
    return this.database.select().from(userPageAssignments);
  }

  async has(userId: string, pageId: string): Promise<boolean> {
    const [record] = await this.database
      .select({ id: userPageAssignments.id })
      .from(userPageAssignments)
      .where(
        and(
          eq(userPageAssignments.userId, userId),
          eq(userPageAssignments.pageId, pageId),
        ),
      )
      .limit(1);
    return Boolean(record);
  }

  async deleteForPage(pageId: string): Promise<void> {
    await this.database
      .delete(userPageAssignments)
      .where(eq(userPageAssignments.pageId, pageId));
  }

  async replace(input: {
    userId: string;
    pageIds: string[];
    assignedByUserId: string;
  }): Promise<void> {
    await this.database
      .delete(userPageAssignments)
      .where(eq(userPageAssignments.userId, input.userId));

    if (input.pageIds.length === 0) return;
    await this.database.insert(userPageAssignments).values(
      input.pageIds.map((pageId) => ({
        userId: input.userId,
        pageId,
        assignedByUserId: input.assignedByUserId,
      })),
    );
  }
}
