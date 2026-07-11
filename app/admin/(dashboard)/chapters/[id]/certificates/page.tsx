import { notFound } from "next/navigation";
import Link from "next/link";
import { requireGlobalAdminPage } from "@/lib/admin-auth";
import { getChapterByIdAdmin } from "@/lib/queries";
import { CertificateDesignsManager } from "@/components/admin/certificate-designs-manager";

// Custom certificate background designs. GLOBAL admin only: certificate
// designs are chapter settings, which local chapter admins cannot edit.
export default async function AdminChapterCertificatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireGlobalAdminPage();

  const chapter = await getChapterByIdAdmin(id);
  if (!chapter) notFound();

  return (
    <div>
      <div className="mb-8">
        <Link
          href={`/admin/chapters/${id}`}
          className="text-sm ad-text-muted hover:ad-text-secondary transition-colors"
        >
          &larr; Back to {chapter.name}
        </Link>
      </div>

      <h1 className="ad-title text-2xl">Certificate Designs</h1>
      <p className="mt-1 ad-text-secondary">{chapter.name}</p>

      <div className="mt-6">
        <CertificateDesignsManager chapterId={id} />
      </div>
    </div>
  );
}
