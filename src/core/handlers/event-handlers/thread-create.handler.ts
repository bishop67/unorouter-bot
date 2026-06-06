import { BugReportService } from "@/core/services/bugs/bug-report.service";
import { ChannelType, type ThreadChannel } from "discord.js";

export async function handleThreadCreate(thread: ThreadChannel): Promise<void> {
  // Only forum/media posts (bug report forum) are relevant.
  if (
    thread.parent?.type !== ChannelType.GuildForum &&
    thread.parent?.type !== ChannelType.GuildMedia
  )
    return;

  if (BugReportService.isBugThread(thread)) {
    await BugReportService.register(thread);
  }
}
