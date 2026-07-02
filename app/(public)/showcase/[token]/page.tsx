import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getShowcaseByToken } from "@/lib/actions/showcase";
import { getShowcaseData } from "@/lib/queries/showcase";
import { ShowcaseView } from "@/components/showcase/showcase-view";

interface PageProps {
  params: Promise<{ token: string }>;
}

// The showcase token gates personal data (applicant profiles + CVs) behind an
// unguessable bearer link. It must never be statically cached: the page resolves
// the chapter fresh on every request and 404s on an invalid/disabled/expired/
// rotated token.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Partner Showcase",
  // Keep the page (and thus the token in its URL) out of every index/archive,
  // and never leak the token via the Referer header when a sponsor clicks an
  // outbound LinkedIn/GitHub link.
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function ShowcasePage({ params }: PageProps) {
  const { token } = await params;

  const showcase = await getShowcaseByToken(token);
  if (!showcase) {
    notFound();
  }

  const data = await getShowcaseData(showcase.chapterId);

  return (
    <ShowcaseView
      token={token}
      showCvs={showcase.showCvs}
      chapter={data.chapter}
      applicants={data.applicants}
      applicantsTruncated={data.applicantsTruncated}
      ranking={data.ranking}
      rankingTruncated={data.rankingTruncated}
      photos={data.photos}
      photosTruncated={data.photosTruncated}
      limits={data.limits}
    />
  );
}
