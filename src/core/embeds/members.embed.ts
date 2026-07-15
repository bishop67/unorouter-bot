import { RED_COLOR } from "@/shared/config/branding";
import type { MemberFlowStats } from "@/core/services/members/member-data.service";
import type { APIEmbed } from "discord.js";

const code = (v: string | number) => `\`${v}\``;

export function membersEmbed(
  guildName: string,
  stats: MemberFlowStats,
): APIEmbed {
  const flow = (count: number) => {
    const percent = stats.memberCount ? (count * 100) / stats.memberCount : 0;
    const s = count >= 0 ? "+" : "";
    return `\`${s}${count} members (${s}${percent.toFixed(2)}%)\``;
  };

  return {
    color: RED_COLOR,
    title: `${guildName}'s Member Count Overview`,
    description: `Memberflow and count in the past ${stats.lookback} days.

**Members**
Users: ${code(stats.memberCount)}
Bots: ${code(stats.botCount)}

**Memberflow 30 Days**
Change: ${flow(stats.thirtyDaysCount)}
**Memberflow 7 Days**
Change: ${flow(stats.sevenDaysCount)}
**Memberflow 24 Hours**
Change: ${flow(stats.oneDayCount)}`,
    timestamp: new Date().toISOString(),
    image: { url: `attachment://${stats.fileName}` },
  };
}
