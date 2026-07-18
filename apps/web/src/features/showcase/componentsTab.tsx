/*
 * Component-inventory tab of the DEV showcase gallery: every file in
 * `components/ui/` rendered under its file name, one after another. Minimal
 * instances only — the interactive walkthroughs live in the other tabs. Safe
 * to delete with the folder.
 */

import { Bell, Check, Inbox, Search, Trash2 } from "lucide-react";
import * as React from "react";
import { AccountDot } from "@/components/ui/account-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { ColorPicker } from "@/components/ui/color-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { DisclosureToggle, ShowMoreButton } from "@/components/ui/disclosure-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, LoadingRow, Notice, RetryableError } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Highlight } from "@/components/ui/highlight";
import { IconButton } from "@/components/ui/icon-button";
import { IconChip } from "@/components/ui/icon-chip";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { LinkButton } from "@/components/ui/link-button";
import { ListRow } from "@/components/ui/list-row";
import { Markdown } from "@/components/ui/markdown";
import { SearchField } from "@/components/ui/search-field";
import { SectionHeader } from "@/components/ui/section-header";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/lib/toast";
import { MOD_LABEL } from "@/lib/utils";

/** File-name heading + rendered samples, stacked by the tab's gap. */
function FileEntry({
  name,
  note,
  children,
}: {
  name: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="font-mono text-xs font-semibold tracking-tight">{name}</h2>
        {note && <p className="text-2xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/** Every `components/ui/` file, in folder order, under its file name. */
export function ComponentsTab() {
  return (
    <>
      <FileEntry name="account-dot.tsx">
        <div className="flex items-center gap-3">
          <AccountDot color="#7c6cf0" className="h-2.5 w-2.5" />
          <AccountDot color="#2f9e77" className="h-2.5 w-2.5" />
          <AccountDot className="h-2.5 w-2.5" />
        </div>
      </FileEntry>

      <FileEntry name="badge.tsx">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="muted">Muted</Badge>
          <Badge variant="success">
            <Check /> Success
          </Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
      </FileEntry>

      <FileEntry name="button.tsx">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="ghost-danger">
            <Trash2 /> Ghost danger
          </Button>
          <Button disabled>Disabled</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Icon button (icon-sm)">
            <Bell />
          </Button>
        </div>
      </FileEntry>

      <FileEntry name="card.tsx">
        <Card>
          <p className="text-sm font-medium">Card</p>
          <p className="text-xs text-muted-foreground">The one elevated panel.</p>
        </Card>
      </FileEntry>

      <FileEntry name="chip.tsx">
        <ChipRow />
      </FileEntry>

      <FileEntry name="color-picker.tsx">
        <ColorPickerRow />
      </FileEntry>

      <FileEntry name="confirm-dialog.tsx">
        <ConfirmDialogRow />
      </FileEntry>

      <FileEntry name="cursor-tooltip.tsx" note="mounted app-wide — hover the button">
        <div className="flex items-center">
          <Button variant="secondary" data-tooltip="The cursor tooltip">
            Hover me
          </Button>
        </div>
      </FileEntry>

      <FileEntry name="dialog.tsx">
        <DialogRow />
      </FileEntry>

      <FileEntry name="disclosure-toggle.tsx">
        <div className="flex flex-col items-start gap-3">
          <DisclosureRow />
          <ShowMoreButton count={4} onClick={() => toast.info("Shows the next page.")} />
        </div>
      </FileEntry>

      <FileEntry name="empty-state.tsx">
        <EmptyState
          icon={Inbox}
          title="Nothing here yet"
          description="When something arrives, it shows up in this list."
        />
      </FileEntry>

      <FileEntry name="feedback.tsx">
        <div className="flex flex-col items-start gap-3">
          <ErrorBanner>Something went wrong while saving.</ErrorBanner>
          <LoadingRow />
          <Notice tone="accent">A notice with the accent tint.</Notice>
          <RetryableError onRetry={() => toast.info("Retried.")}>
            The panel failed to load.
          </RetryableError>
        </div>
      </FileEntry>

      <FileEntry name="form-field.tsx">
        <FormField id="inv-name" label="Full name" hint="As it appears on your account.">
          <Input id="inv-name" placeholder="Ada Lovelace" />
        </FormField>
      </FileEntry>

      <FileEntry name="highlight.tsx">
        <p className="text-sm">
          <Highlight text="Matched text gets the pale accent mark." query="accent" />
        </p>
      </FileEntry>

      <FileEntry name="icon-button.tsx">
        <div className="flex items-center">
          <IconButton aria-label="Notifications">
            <Bell className="h-4 w-4" />
          </IconButton>
        </div>
      </FileEntry>

      <FileEntry name="icon-chip.tsx">
        <div className="flex items-center gap-3">
          <IconChip>
            <Search />
          </IconChip>
          <IconChip tone="tint-neutral">
            <Inbox />
          </IconChip>
          <IconChip size="sm">
            <Bell />
          </IconChip>
        </div>
      </FileEntry>

      <FileEntry name="input.tsx">
        <Input placeholder="Type something…" aria-label="Sample input" />
      </FileEntry>

      <FileEntry name="kbd.tsx">
        <div className="flex items-center gap-2">
          <Kbd>{MOD_LABEL}K</Kbd>
          <Kbd>Esc</Kbd>
        </div>
      </FileEntry>

      <FileEntry name="label.tsx">
        <Label htmlFor="inv-labelled">A form label</Label>
      </FileEntry>

      <FileEntry name="link-button.tsx">
        <div className="flex items-center">
          <LinkButton>Link button</LinkButton>
        </div>
      </FileEntry>

      <FileEntry name="list-row.tsx">
        <ListRow>
          <span className="text-sm">A standalone list row</span>
          <Badge variant="success">Connected</Badge>
        </ListRow>
      </FileEntry>

      <FileEntry name="markdown.tsx">
        <Markdown
          content={
            "**Bold**, *italic*, `inline code`, and a [link](https://example.com).\n\n- One list item\n- Another"
          }
        />
      </FileEntry>

      <FileEntry name="search-field.tsx">
        <SearchFieldRow />
      </FileEntry>

      <FileEntry name="section-header.tsx">
        <div className="flex flex-col gap-4">
          <SectionHeader title="Accent-bar header" description="The default section header." />
          <SectionHeader
            title="Icon header"
            description="The icon-chip variant."
            icon={<Inbox />}
          />
        </div>
      </FileEntry>

      <FileEntry name="select.tsx">
        <SelectRow />
      </FileEntry>

      <FileEntry name="skeleton.tsx">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </FileEntry>

      <FileEntry name="switch.tsx">
        <SwitchRow />
      </FileEntry>

      <FileEntry name="textarea.tsx">
        <Textarea placeholder="Write something…" rows={3} aria-label="Sample textarea" />
      </FileEntry>

      <FileEntry name="toaster.tsx" note="mounted app-wide — fire one">
        <div className="flex items-center">
          <Button variant="secondary" onClick={() => toast.success("A toast from the inventory.")}>
            Show toast
          </Button>
        </div>
      </FileEntry>
    </>
  );
}

function ChipRow() {
  const [active, setActive] = React.useState("all");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {["all", "unread", "waiting"].map((filter) => (
        <Chip key={filter} active={active === filter} onClick={() => setActive(filter)}>
          {filter}
        </Chip>
      ))}
    </div>
  );
}

function ColorPickerRow() {
  const [color, setColor] = React.useState("#7c6cf0");
  return <ColorPicker color={color} onSelect={setColor} />;
}

function ConfirmDialogRow() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex items-center">
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 /> Delete thing
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this thing?"
        description="This can't be undone."
        confirmLabel="Delete"
        onConfirm={() => setOpen(false)}
      />
    </div>
  );
}

function DialogRow() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex items-center">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open dialog
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="A dialog"
        description="Floats over the scrim."
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <Input defaultValue="Some content" aria-label="Dialog content" />
      </Dialog>
    </div>
  );
}

function DisclosureRow() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col items-start gap-2">
      <DisclosureToggle open={open} onToggle={() => setOpen((prev) => !prev)}>
        {open ? "Show less" : "Show more"}
      </DisclosureToggle>
      {open && <p className="text-sm text-muted-foreground">The disclosed content.</p>}
    </div>
  );
}

function SearchFieldRow() {
  const [value, setValue] = React.useState("");
  return <SearchField value={value} onChange={setValue} placeholder="Filter the list…" />;
}

function SelectRow() {
  const [value, setValue] = React.useState("two");
  return (
    <Select
      id="inv-select"
      value={value}
      onChange={setValue}
      options={[
        { value: "one", label: "Option one" },
        { value: "two", label: "Option two" },
        { value: "three", label: "Option three" },
      ]}
    />
  );
}

function SwitchRow() {
  const [on, setOn] = React.useState(true);
  return (
    <div className="flex items-center gap-6">
      <Switch checked={on} onCheckedChange={setOn} aria-label="Sample switch" />
      <Switch disabled aria-label="Disabled switch" />
    </div>
  );
}
