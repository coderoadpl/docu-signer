/**
 * Selectors — the read seam of the members island (selectors-out). The island
 * reads SERVER state through a bound descriptor INJECTED at composition: the web
 * binding (features/members/index.web.ts) passes api.ts's `actions.members` into
 * the core factory, which hands it here. This builder is pure — no api.ts, no
 * React — so the core typechecks WITHOUT DOM (tsconfig.islands.json) and runs in
 * plain node.
 */
export interface MembersDescriptors<TList> {
  readonly list: TList;
}

export const membersSelectorsOf = <TList>(
  descriptors: MembersDescriptors<TList>,
): { readonly list: TList } => ({
  list: descriptors.list,
});
