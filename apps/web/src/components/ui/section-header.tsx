import * as React from "react";

/** Title + description pair shared by top-level section/step headers. */
export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

/** A standard wrapper that groups a SectionHeader with its content. */
export function Section({
  title,
  description,
  children,
  className,
  index = 0,
  layout = "stack",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  className?: string;
  index?: number;
  layout?: "stack" | "row";
}) {
  const header = <SectionHeader title={title} description={description} />;

  return (
    <section
      className={`relative flex flex-col gap-4 ${className || ""}`}
      style={{ animationDelay: `${index * 70}ms`, zIndex: 10 - index }}
    >
      {layout === "row" ? (
        <div className="flex items-center justify-between gap-4">
          {header}
          {children}
        </div>
      ) : (
        <>
          {header}
          {children}
        </>
      )}
    </section>
  );
}
