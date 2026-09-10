import { GREEN_COLOR, WEBSITE_URL } from "@/shared/config/branding";
import { TicketCategory } from "@/core/services/tickets/ticket.service";
import type { APIEmbed } from "discord.js";

const SUPPORT_FIELDS = [
  {
    name: "What do you need help with?",
    value:
      "Describe the problem in your own words. What were you trying to do, and what happened instead?",
  },
  {
    name: "Include if it applies",
    value: [
      "Your username on the site (not your Discord name)",
      "The model you were using",
      "The exact error text, or a screenshot of it",
      "When it started",
    ].join("\n"),
  },
];

const BUG_FIELDS = [
  {
    name: "What went wrong?",
    value:
      "Tell us what you expected to happen and what actually happened instead.",
  },
  {
    name: "Include if it applies",
    value: [
      "The steps to trigger it, in order",
      "The model or page it happens on",
      "The exact error text, or a screenshot of it",
      "Whether it happens every time",
    ].join("\n"),
  },
];

// Posted right after a ticket opens: an empty ticket costs a full round trip
// before staff can even start, and the opener is often gone by the time someone
// asks what they wanted.
export function ticketPromptEmbed(category: TicketCategory): APIEmbed {
  const bug = category === TicketCategory.Bug;
  return {
    color: GREEN_COLOR,
    title: bug ? "Before staff can look into it" : "Tell us what you need",
    description: bug
      ? "Post the details below in this channel. A ticket with no description just waits until someone asks, so the more you write now the faster this moves."
      : `Post the details below in this channel. A ticket with no description just waits until someone asks, so the more you write now the faster this moves.\n\nAccount and balance questions are usually quickest to answer with your site username to hand: ${WEBSITE_URL}`,
    fields: bug ? BUG_FIELDS : SUPPORT_FIELDS,
    footer: {
      text: "Staff have been pinged. Write your message now, they will read it when they arrive.",
    },
  };
}
