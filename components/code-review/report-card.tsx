import type {
  CodeReviewContent,
  CodeReviewContentV2,
  RepoMetadata,
} from "@/lib/types";

function isV2(content: CodeReviewContent): content is CodeReviewContentV2 {
  return "version" in content && content.version === 2;
}

function ScoreBar({
  label,
  score,
  max,
  weight,
  rationale,
  light,
}: {
  label: string;
  score: number;
  max: number;
  weight?: number;
  rationale?: string;
  light?: boolean;
}) {
  const pct = (score / max) * 100;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className={`capitalize ${light ? "text-gray-500" : "text-text-muted"}`}>
          {label.replace(/_/g, " ")}
          {weight != null && (
            <span className={`ml-1 ${light ? "text-gray-400" : "text-text-muted/60"}`}>({weight}%)</span>
          )}
        </span>
        <span className={`font-mono ${light ? "text-amber-600" : "text-gold"}`}>
          {score}/{max}
        </span>
      </div>
      <div className={`mt-1 h-1.5 rounded-full ${light ? "bg-gray-200" : "bg-surface-deep"}`}>
        <div
          className={`h-full rounded-full transition-all ${light ? "bg-amber-500" : "bg-gold"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {rationale && (
        <p className={`mt-0.5 text-xs ${light ? "text-gray-600" : "text-text-muted/80"}`}>{rationale}</p>
      )}
    </div>
  );
}

function SeverityBadge({ severity, light }: { severity: string; light?: boolean }) {
  const darkColors: Record<string, string> = {
    low: "text-text-muted bg-surface-deep",
    medium: "text-amber-400 bg-amber-400/10",
    high: "text-orange-400 bg-orange-400/10",
    critical: "text-red-400 bg-red-400/10",
  };
  const lightColors: Record<string, string> = {
    low: "text-gray-500 bg-gray-100",
    medium: "text-amber-700 bg-amber-100",
    high: "text-orange-700 bg-orange-100",
    critical: "text-red-700 bg-red-100",
  };
  const colors = light ? lightColors : darkColors;
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${colors[severity] ?? colors.low}`}
    >
      {severity}
    </span>
  );
}

function VerdictBadge({ verdict, light }: { verdict: string; light?: boolean }) {
  const darkColors: Record<string, string> = {
    yes: "text-green-400 bg-green-400/10",
    probably: "text-emerald-400 bg-emerald-400/10",
    unlikely: "text-orange-400 bg-orange-400/10",
    no: "text-red-400 bg-red-400/10",
    unknown: "text-text-muted bg-surface-deep",
  };
  const lightColors: Record<string, string> = {
    yes: "text-green-700 bg-green-100",
    probably: "text-emerald-700 bg-emerald-100",
    unlikely: "text-orange-700 bg-orange-100",
    no: "text-red-700 bg-red-100",
    unknown: "text-gray-500 bg-gray-100",
  };
  const colors = light ? lightColors : darkColors;
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-bold ${colors[verdict] ?? colors.unknown}`}
    >
      {verdict}
    </span>
  );
}

// ─── V1 Fallback ────────────────────────────────────────────

function V1ReportCard({ content }: { content: CodeReviewContent }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">{content.summary}</p>
      <div className="space-y-2">
        {Object.entries(content.scores).map(([key, val]) => (
          <ScoreBar key={key} label={key} score={val.score} max={val.max} />
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold text-green-400">Strengths</p>
          <ul className="mt-1 space-y-1 text-xs text-text-secondary">
            {content.strengths.map((s, i) => (
              <li key={i}>+ {s}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-bold text-red-400">Weaknesses</p>
          <ul className="mt-1 space-y-1 text-xs text-text-secondary">
            {content.weaknesses.map((w, i) => (
              <li key={i}>- {w}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── V2 Report Card ─────────────────────────────────────────

function V2ReportCard({
  content,
  metadata,
  light,
}: {
  content: CodeReviewContentV2;
  metadata: RepoMetadata | null;
  light?: boolean;
}) {
  const muted = light ? "text-gray-500" : "text-text-muted";
  const secondary = light ? "text-gray-700" : "text-text-secondary";
  const gold = light ? "text-amber-600" : "text-gold";
  const bgDeep = light ? "bg-gray-100" : "bg-surface-deep";
  const border = light ? "border-gray-200" : "border-white/[0.06]";
  const greenLabel = light ? "text-green-700" : "text-green-400";
  const redLabel = light ? "text-red-700" : "text-red-400";

  return (
    <div className="space-y-5">
      {/* Executive Summary */}
      <div>
        <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>
          Executive Summary
        </p>
        <p className={`mt-1 text-sm ${secondary}`}>
          {content.executive_summary}
        </p>
      </div>

      {/* Weighted Total */}
      <div className={`flex items-center gap-3 rounded-lg ${bgDeep} px-4 py-3`}>
        <span className={`font-mono text-3xl font-bold ${gold}`}>
          {content.weighted_total.toFixed(1)}
        </span>
        <span className={`text-sm ${muted}`}>/ 10 weighted total</span>
      </div>

      {/* Scores */}
      <div>
        <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>
          Scores
        </p>
        <div className="mt-2 space-y-2.5">
          {Object.entries(content.scores).map(([key, val]) => (
            <ScoreBar
              key={key}
              label={key}
              score={val.score}
              max={val.max}
              weight={val.weight}
              rationale={val.rationale}
              light={light}
            />
          ))}
        </div>
      </div>

      {/* Highlights & Concerns */}
      <div className="grid gap-4 sm:grid-cols-2">
        {content.highlights.length > 0 && (
          <div>
            <p className={`text-xs font-bold uppercase tracking-wider ${greenLabel}`}>
              Highlights
            </p>
            <ul className="mt-2 space-y-2">
              {content.highlights.map((h, i) => (
                <li key={i} className={`text-xs ${secondary}`}>
                  <span className={greenLabel}>+</span> {h.description}
                  {h.file && (
                    <span className={`ml-1 font-mono ${light ? "text-gray-400" : "text-text-muted/60"}`}>
                      {h.file}
                      {h.line != null && `:${h.line}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {content.concerns.length > 0 && (
          <div>
            <p className={`text-xs font-bold uppercase tracking-wider ${redLabel}`}>
              Concerns
            </p>
            <ul className="mt-2 space-y-2">
              {content.concerns.map((c, i) => (
                <li key={i} className={`text-xs ${secondary}`}>
                  <SeverityBadge severity={c.severity} light={light} />{" "}
                  {c.description}
                  {c.file && (
                    <span className={`ml-1 font-mono ${light ? "text-gray-400" : "text-text-muted/60"}`}>
                      {c.file}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Strengths & Weaknesses */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className={`text-xs font-bold uppercase tracking-wider ${greenLabel}`}>
            Strengths
          </p>
          <ul className={`mt-1 space-y-1 text-xs ${secondary}`}>
            {content.strengths.map((s, i) => (
              <li key={i}>+ {s}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className={`text-xs font-bold uppercase tracking-wider ${redLabel}`}>
            Weaknesses
          </p>
          <ul className={`mt-1 space-y-1 text-xs ${secondary}`}>
            {content.weaknesses.map((w, i) => (
              <li key={i}>- {w}</li>
            ))}
          </ul>
        </div>
      </div>

      {/* Would it run + Originality */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={`rounded-lg border ${border} p-3`}>
          <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>
            Would it run?
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <VerdictBadge verdict={content.would_it_run.verdict} light={light} />
          </div>
          <p className={`mt-1 text-xs ${muted}`}>
            {content.would_it_run.reasoning}
          </p>
        </div>
        <div className={`rounded-lg border ${border} p-3`}>
          <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>
            Originality
          </p>
          <div className="mt-1.5 flex items-center gap-3">
            <span className={`font-mono text-sm font-bold ${gold}`}>
              {Math.round(content.originality.custom_code_ratio * 100)}%
            </span>
            <span className={`text-xs ${muted}`}>custom code</span>
          </div>
          <p className={`mt-1 text-xs ${muted}`}>
            {content.originality.assessment}
          </p>
        </div>
      </div>

      {/* Repo Metadata */}
      {metadata && (
        <div className={`flex flex-wrap gap-x-4 gap-y-1 border-t ${border} pt-3 text-xs ${muted}`}>
          <span>
            <span className={`font-mono ${secondary}`}>
              {metadata.total_loc.toLocaleString()}
            </span>{" "}
            LOC
          </span>
          <span>
            <span className={`font-mono ${secondary}`}>{metadata.file_count}</span>{" "}
            files
          </span>
          <span>
            <span className={`font-mono ${secondary}`}>{metadata.commit_count}</span>{" "}
            commits
          </span>
          {content.tech_stack_detected.length > 0 && (
            <span>{content.tech_stack_detected.join(", ")}</span>
          )}
          {content.architecture_pattern && content.architecture_pattern !== "Unknown" && (
            <span>{content.architecture_pattern}</span>
          )}
        </div>
      )}

      {content.notable_patterns && (
        <div className={`border-t ${border} pt-3`}>
          <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>
            Notable Patterns
          </p>
          <p className={`mt-1 text-xs ${secondary}`}>
            {content.notable_patterns}
          </p>
        </div>
      )}

      {content.session_history && (
        <div className={`border-t ${border} pt-3`}>
          <p className={`text-xs font-bold uppercase tracking-wider ${muted}`}>
            Session History (advisory bonus, not part of the score)
          </p>
          {content.session_history.analyzed ? (
            <div className="mt-1 space-y-2">
              <div className="flex items-center gap-3">
                <span className={`font-mono text-sm ${gold}`}>
                  {content.session_history.bonus_score.toFixed(1)}/10
                </span>
                {content.session_history.completeness.signed && (
                  <span className={`text-xs ${secondary}`}>signed checkpoints</span>
                )}
                {content.session_history.agents_detected.length > 0 && (
                  <span className={`text-xs ${muted}`}>
                    {content.session_history.agents_detected.join(", ")}
                  </span>
                )}
              </div>
              <p className={`text-xs ${secondary}`}>{content.session_history.summary}</p>
              <div className={`rounded-lg ${bgDeep} p-2 text-xs ${secondary} space-y-0.5`}>
                <p>
                  Ownership: {content.session_history.process_quality.ownership_language.score}/10 &middot;{" "}
                  Specificity: {content.session_history.process_quality.technical_specificity.score}/10 &middot;{" "}
                  Iteration: {content.session_history.process_quality.iteration_verification.score}/10 &middot;{" "}
                  Edge cases: {content.session_history.process_quality.edge_case_awareness.score}/10
                </p>
                <p className={muted}>
                  Completeness: {content.session_history.completeness.score}/10.{" "}
                  {content.session_history.completeness.assessment}
                </p>
              </div>
              {content.session_history.highlights.length > 0 && (
                <ul className={`list-disc pl-4 text-xs ${secondary}`}>
                  {content.session_history.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className={`mt-1 text-xs ${muted}`}>
              {content.session_history.reason ?? "No session history available."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function ReportCard({
  content,
  metadata,
  costUsd,
  light,
}: {
  content: CodeReviewContent;
  metadata?: RepoMetadata | null;
  costUsd?: number | null;
  light?: boolean;
}) {
  if (isV2(content)) {
    return (
      <div>
        <V2ReportCard content={content} metadata={metadata ?? null} light={light} />
        {costUsd != null && costUsd > 0 && (
          <p className={`mt-3 text-right text-[10px] ${light ? "text-gray-400" : "text-text-muted/50"}`}>
            Review cost: ${costUsd.toFixed(4)}
          </p>
        )}
      </div>
    );
  }

  return <V1ReportCard content={content} />;
}
