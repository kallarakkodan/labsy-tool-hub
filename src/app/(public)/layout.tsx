import { Header } from "@/components/public/Header";

/**
 * Chrome for the public catalogue. `/admin` has its own layout (PRD §10), so
 * the header lives here rather than in the root layout — an admin screen with a
 * public search bar across the top would be a confusing surface.
 */
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}
