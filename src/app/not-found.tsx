import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-page px-6 py-24 font-sans text-primary">
      <div className="flex w-full max-w-2xl flex-col gap-4">
        <p className="text-caption font-medium uppercase text-muted">404</p>
        <h1 className="text-title-1 text-primary">Page not found</h1>
        <p className="text-secondary">
          That page does not exist yet. Head back to{" "}
          <Link className="underline" href="/">
            the home page
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
