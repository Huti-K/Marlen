import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CHART_KINDS, CHART_TONES } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { buildChartCard, cardNote } from "./cards.js";
import { textResult, tool } from "./toolkit.js";

const MAX_POINTS = 24;

const CHART_CARD_NOTE = cardNote(
  "this chart",
  "Say in a sentence what it shows; don't read the values back out.",
);

export const presentChartTool: AgentTool = tool({
  name: "present_chart",
  label: "Show a chart",
  description:
    `Draw a small bar or line chart of numbers you are explaining, as a card in the chat. Use it ` +
    `whenever a handful of values reads better as a picture: counts by category, a breakdown, a ` +
    `comparison, a trend over time. Give each point a short label and a numeric value; "bar" ` +
    `suits categories, "line" a trend over ordered points. Keep it to the figures you would ` +
    `otherwise list, and still name the takeaway in your reply.`,
  params: {
    chartType: Type.Union(
      CHART_KINDS.map((k) => Type.Literal(k)),
      { description: 'Chart shape: "bar" for categories, "line" for a trend over ordered points.' },
    ),
    title: Type.Optional(Type.String({ description: 'Short heading, e.g. "Leads by status".' })),
    unit: Type.Optional(Type.String({ description: 'Unit suffix for values, e.g. "€", "%".' })),
    points: Type.Array(
      Type.Object({
        label: Type.String({ description: "Short label for this point (its bar or x position)." }),
        value: Type.Number({ description: "The numeric value." }),
        tone: Type.Optional(
          Type.Union(
            CHART_TONES.map((t) => Type.Literal(t)),
            {
              description:
                'Bar color by meaning: "success", "warning", "danger", "neutral", or "accent" ' +
                "(the default). Ignored for line charts.",
            },
          ),
        ),
      }),
      { description: `The data points, at most ${MAX_POINTS}.` },
    ),
  },
  execute: async ({ chartType, title, unit, points }) => {
    const card = buildChartCard({ chartType, title, unit, points: points.slice(0, MAX_POINTS) });
    if (!card) return textResult("present_chart needs at least one point with a numeric value.");
    return textResult(
      `Presented a ${chartType} chart${title ? ` "${title}"` : ""} with ${card.points.length} ` +
        `point(s).${CHART_CARD_NOTE}`,
      card,
    );
  },
});
