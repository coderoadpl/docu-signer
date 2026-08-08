/**
 * Selectors — the read seam of the __SINGULAR_KEBAB__ island (selectors-out). The
 * island reads SERVER state through a bound descriptor INJECTED at composition:
 * the web binding (features/__SINGULAR_KEBAB__/index.web.ts) passes api.ts's
 * `actions.__SINGULAR_CAMEL__` into the core factory, which hands it here. This
 * builder is pure — no api.ts, no React — so the core typechecks WITHOUT DOM
 * (tsconfig.islands.json) and runs in plain node. The descriptor threads through
 * generically because the core never looks inside it — it only passes it to
 * `useQuery` at the view.
 *
 * <<EXTENSION POINT — client selectors>>
 * When the island graduates (rung 2 = island store on @xstate/store, rung 3 =
 * statechart derived from a core/domain transition table — ADR-0005, decided)
 * add client-derived selectors here behind the SAME shape (plain values, no
 * React), so views never change. See docs/architecture.md §Client application
 * state (ADR-0005).
 */
export interface __SINGULAR_PASCAL__Descriptors<TList> {
  readonly list: TList;
}

export const __SINGULAR_CAMEL__SelectorsOf = <TList>(
  descriptors: __SINGULAR_PASCAL__Descriptors<TList>,
): { readonly list: TList } => ({
  // Replace `actions.__SINGULAR_CAMEL__` (bound in api.ts, injected by index.web.ts)
  // with this island's real read descriptor: reuse an existing resource query
  // (e.g. `actions.todos`), or scaffold one via `pnpm run new:resource`. Until it
  // is bound, `pnpm run check` stays RED.
  list: descriptors.list,
});
