"use client";

import { Fragment, useRef, type CSSProperties, type RefObject } from "react";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, CircleHelp, Mail, Menu, X, type LucideIcon } from "lucide-react";
import s from "../demo.module.css";
import type { DemoTier } from "../lib/demo-adapter";
import { GN, TIERS, money, type BreakdownMark, type NeedState } from "../lib/demo-logic";
import { BenefitLabel, Cell, PdfButton, SourceButton, cx, useDemo } from "./shared";

const vars = (v: Record<string, string | number>) => v as CSSProperties;

const MARK: Record<BreakdownMark, [LucideIcon, string]> = {
  met: [Check, "Met"],
  missed: [X, "Not met"],
  unknown: [CircleHelp, "Unknown"],
  basis: [ArrowLeftRight, "Not scored"],
};

function Gauge({ id, ids, needs, animate }: { id: string; ids: string[]; needs: NeedState[]; animate: boolean }) {
  const { M } = useDemo();
  const sc = M.score(id, ids, needs);
  const tone = M.gaugeTone(sc);
  const arc = "M20 100 A80 80 0 0 1 180 100";
  return (
    <div className={s.gauge}>
      <div className={s.gaugeName}>{M.nm(id)}</div>
      <svg viewBox="0 0 200 115" role="img" aria-label={`${sc.p} percent match`}>
        <title>{`${sc.p} percent match`}</title>
        <path d={arc} fill="none" stroke="var(--rule)" strokeWidth="14" strokeLinecap="round" />
        {sc.p > 0 && (
          <path
            d={arc}
            pathLength={100}
            fill="none"
            stroke={`var(--${tone})`}
            strokeWidth="14"
            strokeLinecap="round"
            className={cx(s.arc, animate && s.animate)}
            style={vars({ "--p": sc.p })}
          />
        )}
        <text x="100" y="92" textAnchor="middle" className={s.gaugeNum}>
          {sc.p}%
        </text>
      </svg>
      <div className={s.muted} style={{ fontSize: 12 }}>
        match to your needs
      </div>
      {sc.miss.length > 0 && <div className={s.gaugeMiss}>Misses a must-have: {sc.miss.join(", ")}</div>}
      {sc.unk > 0 && <div className={s.gaugeUnk}>{sc.unk} couldn&apos;t be confirmed</div>}
      <details>
        <summary>Breakdown</summary>
        {sc.li.map((l) => {
          const [Icon, word] = MARK[l.mark];
          return (
            <div key={l.text} className={cx(s.brk, s[l.mark])}>
              <Icon size={14} strokeWidth={2.75} aria-hidden />
              <span>
                <span className={s.srOnly}>{word}: </span>
                {l.text}
              </span>
            </div>
          );
        })}
      </details>
    </div>
  );
}

function ComparisonTable({
  keys,
  ids,
  swipe,
  onMove,
}: {
  keys: string[];
  ids: string[];
  swipe: boolean;
  onMove: (id: string, dir: -1 | 1) => void;
}) {
  const { M } = useDemo();
  const headRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const fg = M.famGroups(ids);
  const style = vars({ "--n": ids.length });

  const headRows = (withMoves: boolean) => (
    <>
      <tr>
        <th className={s.lab}>
          <span className={s.srOnly}>Plan family</span>
        </th>
        {fg.map((g, i) => (
          <th key={g.f + i} colSpan={g.ids.length} scope="colgroup">
            <span>{g.f}</span>
          </th>
        ))}
      </tr>
      <tr>
        <th className={s.lab} scope="col">
          <span>Benefit</span>
        </th>
        {ids.map((id, i) => (
          <th key={id} scope="col">
            <div className={s.lvlHead}>
              <span className={s.lvl}>{M.lv(id)}</span>
              {withMoves && (
                <span className={s.mv}>
                  {i > 0 && (
                    <button
                      type="button"
                      className={cx(s.quiet, s.iconBtn)}
                      aria-label={`Move ${M.nm(id)} left`}
                      onClick={() => onMove(id, -1)}
                    >
                      <ArrowLeft size={14} aria-hidden />
                    </button>
                  )}
                  {i < ids.length - 1 && (
                    <button
                      type="button"
                      className={cx(s.quiet, s.iconBtn)}
                      aria-label={`Move ${M.nm(id)} right`}
                      onClick={() => onMove(id, 1)}
                    >
                      <ArrowRight size={14} aria-hidden />
                    </button>
                  )}
                </span>
              )}
            </div>
          </th>
        ))}
      </tr>
    </>
  );

  const body = (
    <tbody>
      {TIERS.map((g) => {
        const ks = keys.filter((k) => M.tier(k) == g);
        if (!ks.length) return null;
        return (
          <Fragment key={g}>
            <tr className={s.grp}>
              <td className={s.lab}>{GN[g]}</td>
              <td colSpan={ids.length} />
            </tr>
            {ks.map((k) => (
              <tr key={k}>
                <th scope="row" className={s.lab} style={{ fontWeight: 400 }}>
                  <BenefitLabel k={k} ids={ids} />
                </th>
                {fg.map((gr) => {
                  const n = M.sameForAllLevels(gr, k);
                  return n ? (
                    <td key={gr.ids[0]} colSpan={gr.ids.length}>
                      <div className={s.same}>
                        <div className={s.sameAll}>Same for all {n} levels</div>
                        <Cell id={gr.ids[0]} k={k} />
                      </div>
                    </td>
                  ) : (
                    gr.ids.map((i) => (
                      <td key={i}>
                        <Cell id={i} k={k} />
                      </td>
                    ))
                  );
                })}
              </tr>
            ))}
          </Fragment>
        );
      })}
    </tbody>
  );

  if (!swipe)
    return (
      <div className={s.tw}>
        <table className={s.cmp} style={style}>
          <thead>{headRows(true)}</thead>
          {body}
        </table>
      </div>
    );

  // Phone: the header is its own table pinned under the toolbar; the body swipes
  // sideways (two plan columns per screen) and the header follows its scroll.
  const follow = (from: HTMLDivElement, to: HTMLDivElement | null) => {
    if (to && to.scrollLeft != from.scrollLeft) to.scrollLeft = from.scrollLeft;
  };
  return (
    <div className={cx(s.tw, s.swipe)}>
      <div className={s.swipeHead} ref={headRef} onScroll={(e) => follow(e.currentTarget, bodyRef.current)}>
        <table className={s.cmp} style={style}>
          <thead>{headRows(true)}</thead>
        </table>
      </div>
      <div
        className={s.swipeBody}
        ref={bodyRef}
        onScroll={(e) => follow(e.currentTarget, headRef.current)}
        role="region"
        aria-label="Comparison table, swipe sideways for more plans"
        tabIndex={0}
      >
        <table className={s.cmp} style={style}>
          <thead className={s.srHead}>{headRows(false)}</thead>
          {body}
        </table>
      </div>
    </div>
  );
}

export interface ResultsMainProps {
  ids: string[];
  needs: NeedState[];
  cut: DemoTier;
  swipe: boolean;
  animateGauges: boolean;
  filterRef: RefObject<HTMLDivElement | null>;
  onShowEverything: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onOpenSidebar: (opener: HTMLElement) => void;
}

export function ResultsMain({
  ids,
  needs,
  cut,
  swipe,
  animateGauges,
  filterRef,
  onShowEverything,
  onMove,
  onOpenSidebar,
}: ResultsMainProps) {
  const { M } = useDemo();

  if (!ids.length)
    return (
      <div className={cx(s.card, s.empty)}>
        <div className={s.emptyIc}>
          <Menu size={24} aria-hidden />
        </div>
        <h2>No plans selected</h2>
        <p className={s.muted}>
          Select at least one plan in the <Menu size={16} aria-label="menu" className={s.icon} /> sidebar.
        </p>
        <button type="button" className={cx(s.btn, s.sm)} onClick={(e) => onOpenSidebar(e.currentTarget)}>
          Choose plans
        </button>
      </div>
    );

  const unscored = M.unscoredNeeds(ids, needs);
  const fs = M.filterSummary(ids, cut);
  const one = ids.length == 1;
  const sec = M.sections(ids, cut);
  const contacts = M.contactCards(ids);

  return (
    <>
      <div className={s.counts}>
        {ids.map((i) => {
          const c = M.counts(i, ids);
          return (
            <span key={i}>
              <b>{M.nm(i)}</b>: {c.n} benefits found
              {ids.length > 1 ? `, ${c.a} in all plans, ${c.some} in some, ${c.o} only here` : ""}
            </span>
          );
        })}
      </div>

      <div className={cx(s.gauges, swipe && s.gaugesSwipe)} style={vars({ "--n": ids.length })}>
        {ids.map((i) => (
          <Gauge key={i} id={i} ids={ids} needs={needs} animate={animateGauges} />
        ))}
      </div>
      {unscored.length > 0 && (
        <div className={cx(s.small, s.muted)}>Not scored: {unscored.join(", ")} — no selected document mentions it.</div>
      )}

      <div className={s.filterbar} ref={filterRef} id="filterbar" role="status">
        <span>
          Showing <b>{fs.cutLabel}</b>: {fs.shown} of {fs.total} benefits
          {fs.hidden ? `. Hidden: ${fs.hidden}` : ""}. The match score above always uses everything.
        </span>
        {cut < 3 && (
          <button type="button" className={s.quiet} onClick={onShowEverything}>
            Show everything
          </button>
        )}
      </div>

      {one ? (
        <>
          <div className={s.sechead}>
            <h2>{M.nm(ids[0])}</h2>
            <span className={cx(s.muted, s.small)}>Everything this document states, in plain English</span>
          </div>
          <div className={s.tw}>
            <table className={s.cmp}>
              <tbody>
                {TIERS.map((g) => {
                  const gk = M.singlePlanKeys(ids[0], cut).filter((k) => M.tier(k) == g);
                  if (!gk.length) return null;
                  return (
                    <Fragment key={g}>
                      <tr className={s.grp}>
                        <td className={s.lab}>{GN[g]}</td>
                        <td />
                      </tr>
                      {gk.map((k) => (
                        <tr key={k}>
                          <th scope="row" className={s.lab} style={{ fontWeight: 400 }}>
                            <BenefitLabel k={k} />
                          </th>
                          <td>
                            <Cell id={ids[0]} k={k} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div className={s.sechead}>
            <h2>In all your plans</h2>
            <span className={cx(s.muted, s.small)}>{sec.all.length} benefits every selected plan states</span>
          </div>
          {sec.all.length ? (
            <ComparisonTable keys={sec.all} ids={ids} swipe={swipe} onMove={onMove} />
          ) : (
            <div className={s.muted}>No benefit appears in every selected plan.</div>
          )}
          {sec.some.length > 0 && (
            <>
              <div className={s.sechead}>
                <h2>In some of your plans</h2>
                <span className={cx(s.muted, s.small)}>
                  {sec.some.length} benefits stated by some plans; the others don&apos;t mention them
                </span>
              </div>
              <ComparisonTable keys={sec.some} ids={ids} swipe={swipe} onMove={onMove} />
            </>
          )}
          {sec.one.length > 0 && (
            <>
              <div className={s.sechead}>
                <h2>Only in one plan</h2>
                <span className={cx(s.muted, s.small)}>
                  {sec.one.length} benefit{sec.one.length == 1 ? "" : "s"}
                </span>
              </div>
              <div className={s.onecards}>
                {ids.map((i) => {
                  const ks = sec.one.filter((k) => M.F(i, k));
                  if (!ks.length) return null;
                  return (
                    <div className={s.card} key={i}>
                      <h3>{M.nm(i)}</h3>
                      {ks.map((k) => (
                        <div className={s.item} key={k}>
                          <BenefitLabel k={k} />
                          <div>
                            <Cell id={i} k={k} />
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      <div className={s.sechead}>
        <h2>What if you get two separate illnesses this year?</h2>
        <span className={cx(s.muted, s.small)}>Deductibles only, using each document&apos;s own basis</span>
      </div>
      <div className={cx(s.card, s.what)}>
        {M.whatIf(ids).map((r) =>
          r.fact ? (
            <div className={s.whatRow} key={r.id}>
              <span>
                <b>{M.nm(r.id)}</b>
                <br />
                <span className={cx(s.muted, s.small)}>{r.how}</span>
              </span>
              <span className={s.amtCol}>
                <span className={s.amt}>{money(r.amount)}</span>
                <br />
                <SourceButton id={r.id} k="ded" label={M.pageLabel(r.id, r.fact.p)} />
              </span>
            </div>
          ) : (
            <div className={s.whatRow} key={r.id}>
              <b>{M.nm(r.id)}</b>
              <span className={s.muted}>{r.how}</span>
            </div>
          ),
        )}
      </div>

      <div className={s.sechead}>
        <h2>Contact the insurer</h2>
        <span className={cx(s.muted, s.small)}>
          Drafts open in your own email app. We never send email or collect your address.
        </span>
      </div>
      <div className={s.onecards}>
        {contacts.map((c) => (
          <div className={s.card} key={c.docId}>
            <h3>{c.family}</h3>
            {c.contacts.map((x) => (
              <div className={s.contactLine} key={x.kind + x.value}>
                {x.label}: <b>{x.value}</b>
                <br />
                <PdfButton docId={c.docId} page={x.page} label={`Page ${x.page}`} />
              </div>
            ))}
            {c.questionsHref && c.requestHref ? (
              <div className={s.mailRow}>
                <a className={cx(s.btn, s.sm)} href={c.questionsHref}>
                  <Mail size={16} aria-hidden />
                  Email my {c.questions.length} open questions
                </a>
                <a className={cx(s.btn, s.sm, s.sec)} href={c.requestHref}>
                  Request the plan documents
                </a>
              </div>
            ) : (
              <div className={cx(s.small, s.muted)} style={{ marginTop: "var(--s2)" }}>
                No email address in this document. Call, or use their website.
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
