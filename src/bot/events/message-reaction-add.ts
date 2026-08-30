import { ExpressionUsageService } from "@/core/services/expressions/expression-usage.service";
import type { ArgsOf } from "discordx";
import { Discord, On } from "discordx";

@Discord()
export class MessageReactionAdd {
  @On()
  async messageReactionAdd([reaction, user]: ArgsOf<"messageReactionAdd">) {
    if (user.bot) return;
    // Reactions on messages older than the cache arrive partial.
    if (reaction.partial) {
      const full = await reaction.fetch().catch(() => null);
      if (!full) return;
      await ExpressionUsageService.trackReaction(full);
      return;
    }
    await ExpressionUsageService.trackReaction(reaction);
  }
}
