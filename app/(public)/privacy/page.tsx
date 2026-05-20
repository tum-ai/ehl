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
            Registration: name, email, password (hashed)
          </li>
          <li>
            Applications: personal info (name, DOB, gender, nationality,
            university), skills, dietary preferences, t-shirt size, CV
            (optional)
          </li>
          <li>
            Event participation: check-in status, team membership, challenge
            registrations, submissions
          </li>
          <li>
            Technical: IP addresses (for rate limiting, retained 90 days),
            browser info (for error reporting)
          </li>
        </ul>
      </div>

      {/* 3. How We Use Your Data */}
      <div className="mb-8" id="data-usage">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          3. How We Use Your Data
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary">
          <li>Event organization, team matching, catering planning</li>
          <li>Scoring, certificates, leaderboard</li>
          <li>Communication about events you are registered for</li>
          <li>Platform improvement and error tracking</li>
        </ul>
      </div>

      {/* 4. Special Categories of Data */}
      <div className="mb-8" id="special-data">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          4. Special Categories of Data
        </h2>
        <p className="text-text-secondary mb-4">
          Dietary preferences, date of birth, gender, and nationality are
          processed for catering planning and anonymized statistical purposes
          only. Legal basis: explicit consent (Art. 9(2)(a) GDPR).
        </p>
      </div>

      {/* 5. Media Usage */}
      <div className="mb-8" id="media">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          5. Media Usage
        </h2>
        <p className="text-text-secondary mb-4">
          Photos and videos taken during events may be used for marketing, social
          media, press, and event documentation by EHL and event sponsors. You
          can revoke this consent at any time.
        </p>
      </div>

      {/* 6. Challenge Terms & Intellectual Property */}
      <div className="mb-8" id="challenge-terms">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          6. Challenge Terms & Intellectual Property
        </h2>
        <p className="text-text-secondary mb-4">
          Challenge data provided by sponsors is to be used solely for the
          hackathon challenge. IP rights to submissions may be subject to terms
          outlined in individual challenge descriptions. By participating, you
          agree to these terms.
        </p>
      </div>

      {/* 7. Third-Party Sharing */}
      <div className="mb-8" id="third-party-sharing">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          7. Third-Party Sharing
        </h2>
        <p className="text-text-secondary mb-4">
          With your optional consent, we may share:
        </p>
        <ul className="list-disc list-inside space-y-2 text-text-secondary mb-4">
          <li>
            Your profile and CV with recruiters and sponsors for job
            opportunities
          </li>
          <li>
            Your name, university, and contact info with event sponsors for
            follow-up
          </li>
          <li>Newsletter subscription data with our email service provider</li>
        </ul>
        <p className="text-text-secondary">We never sell your data.</p>
      </div>

      {/* 8. Newsletters */}
      <div className="mb-8" id="newsletters">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          8. Newsletters
        </h2>
        <p className="text-text-secondary mb-4">
          Optional. You can unsubscribe at any time via the link in each email.
        </p>
      </div>

      {/* 9. Data Retention */}
      <div className="mb-8" id="data-retention">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          9. Data Retention
        </h2>
        <ul className="list-disc list-inside space-y-2 text-text-secondary mb-4">
          <li>Account data: retained while your account is active</li>
          <li>
            Applications: retained for the duration of the season + 1 year
          </li>
          <li>
            Event logs: retained indefinitely for audit/compliance (anonymized
            after account deletion)
          </li>
          <li>IP addresses: 90 days</li>
          <li>You can request deletion at any time.</li>
        </ul>
      </div>

      {/* 10. Your Rights */}
      <div className="mb-8" id="your-rights">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          10. Your Rights
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
      </div>

      {/* 11. Changes */}
      <div className="mb-8" id="changes">
        <h2 className="text-xl font-bold text-text-primary mb-4">
          11. Changes
        </h2>
        <p className="text-text-secondary mb-4">
          We may update this policy. Changes will be posted on this page.
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
