import { EMAIL_BODY_FONT_FAMILY } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bold, ImagePlus, Italic, Link2, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RetryableError } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/** Kept under the 500 KB server cap for the whole signature with room for markup and a second image. */
const MAX_INLINE_IMAGE_BYTES = 300 * 1024;

const SIGNATURES_QUERY_KEY = ["settings", "accountSignatures"] as const;

/**
 * Keeps useful mail-client formatting while dropping active/unsafe content and
 * Word/Outlook paste cruft: conditional comments, namespaced wrappers (<o:p>),
 * mso-* style props, and class names (dead weight once stylesheets are gone).
 */
function sanitizeSignatureHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((el) => {
    el.remove();
  });
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  const comments: ChildNode[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode as ChildNode);
  for (const node of comments) node.remove();
  doc.querySelectorAll("*").forEach((el) => {
    if (el.tagName.includes(":")) {
      el.replaceWith(...el.childNodes);
      return;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "contenteditable" ||
        name === "class" ||
        name === "lang" ||
        ((name === "href" || name === "src") && value.startsWith("javascript:"))
      ) {
        el.removeAttribute(attr.name);
      }
    }
    const style = el.getAttribute("style");
    if (style) {
      const kept = style
        .split(";")
        .map((decl) => decl.trim())
        .filter((decl) => decl && !/^mso-/i.test(decl));
      if (kept.length > 0) el.setAttribute("style", kept.join("; "));
      else el.removeAttribute("style");
    }
  });
  return doc.body.innerHTML.trim();
}

/**
 * Rich signature editor, expanded under an email account's row. Deliberately a
 * raw contenteditable, NOT a schema-based editor (TipTap was tried and
 * reverted): a signature pasted from Gmail or Outlook must keep its layout
 * tables, fonts and colors verbatim, which schema normalization flattens.
 * Paste-first, with a small toolbar for writing one in place. The editing area
 * is a white "paper" page in both themes, in the same font the server wraps
 * outgoing bodies in, so what's shown is what recipients get. Persists the
 * stored set wholesale with this account's entry swapped (the server keeps the
 * last entry per account and drops empty ones).
 */
export function SignatureEditor({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editor = React.useRef<HTMLDivElement>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  // The toolbar's link/image flows move focus away from the editor; the last
  // in-editor selection is saved on toolbar use and restored before inserting.
  const savedRange = React.useRef<Range | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");

  // The loaded array is the merge baseline for the save; saving is disabled
  // until it arrives, so a write can never wipe other accounts' signatures.
  const query = useQuery({ queryKey: SIGNATURES_QUERY_KEY, queryFn: api.accountSignatures });
  const signatures = query.data?.signatures;

  // Seed the editor once when the stored set first arrives; later signature
  // state updates (a save) must not clobber what the user is editing.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (seededRef.current || !signatures || !editor.current) return;
    seededRef.current = true;
    editor.current.innerHTML = sanitizeSignatureHtml(
      signatures.find((s) => s.accountId === accountId)?.html ?? "",
    );
  }, [signatures, accountId]);

  const exec = (command: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, value);
  };

  const saveSelection = () => {
    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      editor.current?.contains(selection.getRangeAt(0).commonAncestorContainer)
    ) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const range = savedRange.current;
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const applyLink = () => {
    const url = linkUrl.trim();
    setLinkOpen(false);
    if (!url) return;
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    restoreSelection();
    const selection = window.getSelection();
    const inEditor =
      selection &&
      selection.rangeCount > 0 &&
      editor.current?.contains(selection.getRangeAt(0).commonAncestorContainer);
    if (inEditor && !selection.isCollapsed) {
      exec("createLink", href);
    } else {
      // Nothing selected: insert the URL itself as the link text.
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.textContent = href;
      exec("insertHTML", anchor.outerHTML);
    }
  };

  const insertImage = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      toast.error(t("connections.signature.imageTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      restoreSelection();
      exec("insertImage", reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!signatures) return;
    const html = sanitizeSignatureHtml(editor.current?.innerHTML ?? "");
    setSaving(true);
    try {
      const merged = [...signatures.filter((s) => s.accountId !== accountId), { accountId, html }];
      const { signatures: saved } = await api.setAccountSignatures(merged);
      queryClient.setQueryData(SIGNATURES_QUERY_KEY, { signatures: saved });
      toast.success(t(html ? "connections.signature.saved" : "connections.signature.removed"));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  // Toolbar buttons prevent mousedown default so the editor selection survives the click.
  const keepSelection = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className="surface flex flex-col gap-2 rounded-lg p-3">
      <p className="px-2 text-xs text-muted-foreground">{t("connections.signature.hint")}</p>
      {query.isError ? (
        <RetryableError onRetry={() => void query.refetch()}>
          {t("connections.signature.loadFailed")}
        </RetryableError>
      ) : (
        <>
          <div className="flex items-center gap-0.5 px-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.bold")}
              data-tooltip={t("connections.signature.bold")}
              onMouseDown={keepSelection}
              onClick={() => exec("bold")}
            >
              <Bold />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.italic")}
              data-tooltip={t("connections.signature.italic")}
              onMouseDown={keepSelection}
              onClick={() => exec("italic")}
            >
              <Italic />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.link")}
              data-tooltip={t("connections.signature.link")}
              onMouseDown={keepSelection}
              onClick={() => {
                saveSelection();
                setLinkUrl("");
                setLinkOpen((open) => !open);
              }}
            >
              <Link2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("connections.signature.image")}
              data-tooltip={t("connections.signature.image")}
              onMouseDown={keepSelection}
              onClick={() => {
                saveSelection();
                fileInput.current?.click();
              }}
            >
              <ImagePlus />
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="hidden"
              onChange={(event) => {
                insertImage(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
          {linkOpen && (
            <div className="flex items-center gap-2 px-1">
              <Input
                autoFocus
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                placeholder={t("connections.signature.linkPlaceholder")}
                className="h-8 text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyLink();
                  }
                  if (event.key === "Escape") setLinkOpen(false);
                }}
              />
              <Button variant="secondary" size="sm" onClick={applyLink}>
                {t("connections.signature.linkApply")}
              </Button>
            </div>
          )}
          {/* Recessed frame holding the white "paper" page: the outgoing-email preview stays light in both themes. */}
          <div className="rounded-lg bg-surface-2 p-2">
            {/* biome-ignore lint/a11y/useFocusableInteractive: contenteditable makes the div focusable */}
            {/* biome-ignore lint/a11y/useSemanticElements: no native element holds rich HTML; textbox is the standard role for a contenteditable editor */}
            <div
              ref={editor}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label={t("connections.signature.title")}
              className="min-h-24 break-words rounded-md bg-white px-3 py-2 text-sm leading-normal text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_a]:text-blue-700 [&_a]:underline [&_img]:max-w-full"
              style={{ fontFamily: EMAIL_BODY_FONT_FAMILY }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (editor.current) editor.current.innerHTML = "";
              }}
            >
              <X />
              {t("connections.signature.clear")}
            </Button>
            <Button size="sm" loading={saving} disabled={!signatures} onClick={() => void save()}>
              {t("connections.signature.save")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
