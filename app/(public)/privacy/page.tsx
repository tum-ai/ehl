import { Section } from "@/components/ui/section";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | EHL",
  description:
    "European Hackathon League privacy policy and data processing information.",
};

export default function PrivacyPage() {
  return (
    <Section className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-black text-text-primary mb-2">
        Privacy Policy
      </h1>
      <p className="text-sm text-text-muted mb-8">Last updated: May 2026</p>

      {/* 1. Data Controller */}
      <div className="mb-8" id="data-controller">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          1. Data Controller
        </h2>
        <p className="text-text-secondary mb-4">
          European Hackathon League (EHL), operated by TUM.ai e.V., Arcisstrasse
          21, 80333 Munich, Germany. Contact:{" "}
          <a
            href="mailto:ehl@tum-ai.com"
            className="text-gold hover:underline"
          >
            ehl@tum-ai.com
          </a>
        </p>
      </div>

      {/* 2. What Data We Collect */}
      <div className="mb-8" id="data-collected">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          2. What Data We Collect
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <strong>Registration:</strong> name, email, password (hashed)
          </li>
          <li>
            <strong>Applications:</strong> personal info (name, date of birth, gender, nationality,
            location), academic background (university, degree, field of study),
            skills, hackathon experience, dietary preferences, t-shirt size, CV (optional),
            social media links (optional)
          </li>
          <li>
            <strong>Event participation:</strong> check-in status and timestamps, team membership and role,
            challenge registrations, project submissions (including repository URLs and project descriptions)
          </li>
          <li>
            <strong>Technical data:</strong> IP addresses (for rate limiting and abuse prevention),
            browser user agent strings (for error reporting), page URLs visited when errors occur
          </li>
          <li>
            <strong>Consent records:</strong> your consent choices (privacy policy, challenge terms,
            newsletter, recruiter sharing) are stored with your application
          </li>
        </ul>
      </div>

      {/* 3. How We Use Your Data */}
      <div className="mb-8" id="data-usage">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          3. How We Use Your Data
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>Event organization, team matching, and catering planning</li>
          <li>Application screening and acceptance decisions</li>
          <li>QR code generation for event check-in</li>
          <li>Scoring, certificates, and leaderboard rankings</li>
          <li>Communication about events you are registered for</li>
          <li>Platform improvement and error tracking</li>
        </ul>
      </div>

      {/* 4. Public Information */}
      <div className="mb-8" id="public-data">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          4. Public Information
        </h2>
        <p className="text-text-secondary mb-4">
          The following information is publicly visible on the EHL website:
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>Team names, universities, and cities on the leaderboard and team pages</li>
          <li>Placement results and points for each match</li>
          <li>Team member names (first name and last initial) on team pages</li>
        </ul>
        <p className="text-text-secondary mt-4">
          Your email, date of birth, dietary preferences, and other personal
          details are never publicly displayed.
        </p>
      </div>

      {/* 5. Special Categories of Data */}
      <div className="mb-8" id="special-data">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          5. Special Categories of Data
        </h2>
        <p className="text-text-secondary mb-4">
          Dietary preferences, date of birth, gender, and nationality are
          processed for catering planning and anonymized statistical purposes
          only. Legal basis: explicit consent (Art. 9(2)(a) GDPR).
        </p>
      </div>

      {/* 6. Media Usage */}
      <div className="mb-8" id="media">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          6. Media Usage
        </h2>
        <p className="text-text-secondary mb-4">
          Photos and videos taken during events may be used for marketing, social
          media, press, and event documentation by EHL and event sponsors. You
          can revoke this consent at any time by contacting us.
        </p>
      </div>

      {/* 7. Challenge Terms & Intellectual Property */}
      <div className="mb-8" id="challenge-terms">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          7. Challenge Terms & Intellectual Property
        </h2>
        <p className="text-text-secondary mb-4">
          Challenge data provided by sponsors is to be used solely for the
          hackathon challenge. IP rights to submissions may be subject to terms
          outlined in individual challenge descriptions. By participating, you
          agree to these terms.
        </p>
      </div>

      {/* 8. Submission Processing & Code Review */}
      <div className="mb-8" id="submissions">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          8. Submission Processing & Code Review
        </h2>
        <p className="text-text-secondary mb-4">
          When you submit a project, the following processing occurs:
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <strong>Repository snapshots:</strong> Your GitHub/GitLab repository is forked into the
            EHL organization for archival and jury review. Jury members are granted
            read access to your repository as GitHub collaborators.
          </li>
          <li>
            <strong>AI-powered code review:</strong> Your submission (including repository code and
            challenge brief) may be analyzed by AI models via OpenRouter for automated
            code quality assessment. This analysis is used alongside human jury evaluation.
          </li>
          <li>
            <strong>Jury evaluation:</strong> Submissions are reviewed and ranked by human jury members.
            Jury rankings and feedback are stored to determine final placements.
          </li>
        </ul>
      </div>

      {/* 9. Application Screening */}
      <div className="mb-8" id="screening">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          9. Application Screening
        </h2>
        <p className="text-text-secondary mb-4">
          Applications are reviewed and scored by human screeners to determine acceptance.
          Screening scores are stored with the screener identity for quality assurance.
          Acceptance and rejection decisions are communicated via email.
        </p>
      </div>

      {/* 10. Third-Party Service Providers */}
      <div className="mb-8" id="service-providers">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          10. Third-Party Service Providers
        </h2>
        <p className="text-text-secondary mb-4">
          We use the following service providers to operate the platform. Data is
          shared with them only as necessary for the stated purpose:
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <strong>Supabase</strong> (EU, database and authentication): stores all account data,
            applications, and event records
          </li>
          <li>
            <strong>Vercel</strong> (hosting): serves the website, processes requests, and provides
            infrastructure logging
          </li>
          <li>
            <strong>Google Drive</strong> (file storage): stores uploaded CVs and event-related documents
          </li>
          <li>
            <strong>GitHub</strong> (repository hosting): stores submission repository snapshots,
            provides jury access to code
          </li>
          <li>
            <strong>OpenRouter</strong> (AI processing): processes submission code for automated
            code review using AI models (Google Gemini, Anthropic Claude)
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> (bot protection): verifies that form submissions
            are made by humans, processes IP addresses and browser signals
          </li>
          <li>
            <strong>Upstash</strong> (rate limiting): temporarily stores IP addresses to prevent
            abuse (data retained only during the rate limit window)
          </li>
          <li>
            <strong>Gmail SMTP</strong> (email delivery): sends transactional emails (confirmations,
            acceptances, rejections, certificates)
          </li>
        </ul>
        <p className="text-text-secondary mt-4">We never sell your data.</p>
      </div>

      {/* 11. Third-Party Sharing (Optional Consent) */}
      <div className="mb-8" id="third-party-sharing">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          11. Third-Party Sharing (Optional)
        </h2>
        <p className="text-text-secondary mb-4">
          With your optional consent, we may share:
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            Your profile and CV with recruiters and sponsors for job
            opportunities
          </li>
          <li>
            Your name, university, and contact info with event sponsors for
            follow-up
          </li>
          <li>Newsletter updates about EHL events and results</li>
        </ul>
        <p className="text-text-secondary mt-4">
          You can withdraw this consent at any time by contacting us.
        </p>
      </div>

      {/* 12. Technical Data & Error Reporting */}
      <div className="mb-8" id="technical-data">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          12. Technical Data & Error Reporting
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>
            <strong>Rate limiting:</strong> IP addresses are temporarily stored to prevent abuse.
            Rate limit data is retained only for the duration of the limit window (typically 60 seconds
            to 1 hour).
          </li>
          <li>
            <strong>Error reporting:</strong> When browser errors occur, we collect the error message,
            page URL, and browser user agent string for debugging purposes. This data is logged
            automatically and retained with event logs.
          </li>
          <li>
            <strong>Bot protection:</strong> Cloudflare Turnstile processes browser signals and
            IP addresses to verify that form submissions are human. No cookies are set.
          </li>
        </ul>
      </div>

      {/* 13. Data Retention */}
      <div className="mb-8" id="data-retention">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          13. Data Retention
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>Account data: retained while your account is active</li>
          <li>
            Applications and screening scores: retained for the duration of the season plus 1 year
          </li>
          <li>
            Submissions and code reviews: retained for the duration of the season plus 1 year
          </li>
          <li>
            Event logs: retained indefinitely for audit and compliance purposes.
            Logs record actions such as application submissions, status changes, and check-ins.
            Personal identifiers are removed upon account deletion, but anonymized log entries
            are preserved.
          </li>
          <li>Rate limiting data (IP addresses): retained for the rate limit window only</li>
          <li>You can request deletion of your data at any time.</li>
        </ul>
      </div>

      {/* 14. Your Rights */}
      <div className="mb-8" id="your-rights">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          14. Your Rights
        </h2>
        <p className="text-text-secondary mb-4">
          Under GDPR, you have the right to: access, rectification, deletion,
          restriction, data portability, and objection. To exercise any right,
          contact{" "}
          <a
            href="mailto:ehl@tum-ai.com"
            className="text-gold hover:underline"
          >
            ehl@tum-ai.com
          </a>
          .
        </p>
        <p className="text-text-secondary">
          You also have the right to lodge a complaint with the Bavarian Data Protection
          Authority (BayLDA).
        </p>
      </div>

      {/* 15. Changes */}
      <div className="mb-8" id="changes">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          15. Changes
        </h2>
        <p className="text-text-secondary mb-4">
          We may update this policy. Changes will be posted on this page with an
          updated date.
        </p>
      </div>

      {/* Back to home */}
      <div className="pt-4 border-t border-white/10">
        <Link href="/" className="text-gold hover:underline text-sm">
          Back to home
        </Link>
      </div>
    </Section>
  );
}
