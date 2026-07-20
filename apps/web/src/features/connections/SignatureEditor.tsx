import type { AccountSignature } from "@marlen/shared";
import { X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RetryableError } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/** Keeps useful mail-client formatting while dropping active/unsafe content. */
function sanitizeSignatureHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,iframe,object,embed,form,input,button").forEach((el) => {
    el.remove();
  });
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (
        name.startsWith("on") ||
        name === "contenteditable" ||
        ((name === "href" || name === "src") && value.startsWith("javascript:"))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML.trim();
}

/**
 * Rich signature editor, expanded under an email account's row. Paste-first: a
 * signature copied from Gmail or Outlook lands with its formatting, links and
 * images intact. Loads the stored set itself and persists it wholesale with
 * this account's entry swapped (the server keeps the last entry per account and
 * drops empty ones).
 */
export function SignatureEditor({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const editor = React.useRef<HTMLDivElement>(null);
  // null until loaded; the loaded array is the merge baseline for the save, so
  // persisting against an unloaded set would wipe other accounts' signatures.
  const [signatures, setSignatures] = React.useState<AccountSignature[] | null>(null);
  const [loadFailed, setLoadFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoadFailed(false);
    try {
      setSignatures((await api.accountSignatures()).signatures);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  React.useEffect(() => void load(), [load]);

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

  const save = async () => {
    if (!signatures) return;
    const html = sanitizeSignatureHtml(editor.current?.innerHTML ?? "");
    setSaving(true);
    try {
      const merged = [...signatures.filter((s) => s.accountId !== accountId), { accountId, html }];
      const { signatures: saved } = await api.setAccountSignatures(merged);
      setSignatures(saved);
      toast.success(t(html ? "connections.signature.saved" : "connections.signature.removed"));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="surface flex flex-col gap-2 rounded-lg p-3">
      <p className="px-2 text-xs text-muted-foreground">{t("connections.signature.hint")}</p>
      {loadFailed ? (
        <RetryableError onRetry={() => void load()}>
          {t("connections.signature.loadFailed")}
        </RetryableError>
      ) : (
        <>
          {/* biome-ignore lint/a11y/useFocusableInteractive: contenteditable makes the div focusable */}
          {/* biome-ignore lint/a11y/useSemanticElements: no native element holds rich HTML; textbox is the standard role for a contenteditable editor */}
          <div
            ref={editor}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label={t("connections.signature.title")}
            className="field min-h-24 break-words px-3 py-2 text-sm [&_img]:max-w-full"
          />
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
