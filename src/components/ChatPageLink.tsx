import Link from "next/link";
import { APP_PAGES, appPage } from "@scout/core";

// The page a chat reply offers to open. Only core's allow-listed pages render;
// anything else (an old or tampered turn) shows nothing.
export function ChatPageLink({ page }: { page: string | undefined }) {
  const target = page ? appPage(page) : null;
  if (!target) return null;
  return (
    <p>
      <Link
        href={target}
        className="text-body-sm font-medium text-primary underline underline-offset-2"
      >
        Open {APP_PAGES[target]}
      </Link>
    </p>
  );
}
