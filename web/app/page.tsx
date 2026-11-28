import DemoApp from "./demo/components/DemoApp";

/** /: the V2 screens (docs/v2/design.md, D-038) on the user's own uploaded documents,
 *  fed by the engine's results. The V1 screens are no longer routed (owner, 2026-11-28);
 *  the demo with invented data stays at /demo. */
export default function Home() {
  return <DemoApp source="live" />;
}
