import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "@/components/ui/markdown";

// Markdown reaches toast (and through it sonner/i18n, which need a DOM) only
// inside click handlers this test never fires; cut the chain at the seam.
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Streaming replies re-render through this path on every delta; a crash or a
// dropped word here breaks live chat, not just the fade-in.
describe("Markdown stream mode", () => {
  it("wraps streamed words in fade-in spans, leaving code untouched", () => {
    const html = renderToStaticMarkup(
      <Markdown stream content={"Hello **bold** world\n\n```\nconst x = 1\n```"} />,
    );
    expect(html).toContain('<span class="stream-word">Hello</span>');
    expect(html).toContain('<span class="stream-word">bold</span>');
    expect(html).toContain("const x = 1");
    expect(html).not.toContain('<span class="stream-word">const</span>');
  });

  it("renders plain markdown when not streaming", () => {
    const html = renderToStaticMarkup(<Markdown content="Hello world" />);
    expect(html).not.toContain("stream-word");
  });
});
