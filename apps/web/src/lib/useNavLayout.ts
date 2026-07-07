import * as React from "react";

export type NavLayout = "dock" | "sidebar";

export function useNavLayout() {
  const [layout, setLayout] = React.useState<NavLayout>(() => {
    if (typeof window === "undefined") return "dock";
    return (localStorage.getItem("trailin-nav-layout") as NavLayout) || "dock";
  });

  React.useEffect(() => {
    localStorage.setItem("trailin-nav-layout", layout);
    const event = new CustomEvent("trailin:nav-layout-changed", { detail: layout });
    window.dispatchEvent(event);
  }, [layout]);

  React.useEffect(() => {
    const handleLayout = (e: CustomEvent<NavLayout>) => {
      if (e.detail !== layout) {
        setLayout(e.detail);
      }
    };
    window.addEventListener("trailin:nav-layout-changed", handleLayout as EventListener);
    return () => window.removeEventListener("trailin:nav-layout-changed", handleLayout as EventListener);
  }, [layout]);

  return [layout, setLayout] as const;
}
