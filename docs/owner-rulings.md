# Owner rulings — provenance archive

Security-relevant rule reversals require an owner-visible artifact in this
repository before `ai-review` may accept them (see [CLAUDE.md](../CLAUDE.md)).
The confirming statements were originally posted as pull-request comments in
the private repository this project was developed in; they are reproduced here
verbatim so the record survives independently of that repository.

## 2026-08-15 — owner promotion wall on `main`

Reverses the SIL-2 autonomous-merge rule (the agent merged to `main` on green
gates without an owner review). Given in the working session that armed the
branch rulesets; the owner's confirming comment and approving review on the
pull request recording this ruling are the owner-visible artifact.

> u Together ściana review gate'uje Ciebie - i to jest okej zrobmy tak samo
> promocje na prod bede robil ja

(Gloss: the first clause quotes back the agent's message addressed to the
owner — "at Together the review wall gates you [the owner]" — and the owner
affirms it: adopt the same wall here; production promotions are the owner's.
Asked the same day whether the agent may at least execute the merge once the
approving review and the four green checks are in place, the owner ruled:)

> Merguję osobiście

(Gloss: the owner performs the merge personally; the agent's authority ends
at opening the pull request. Reversed later the same evening — asked to
execute merges of PRs the owner had already approved, the owner ruled:)

> a nie mzoesz ty mergowac? przecez dalem approve

(Gloss, verbatim spelling preserved: "can't you merge? I gave the approve
after all" — the approving review is the release decision; the merge
mechanics may be executed by the agent once the approval and the four green
checks are in place.)

## 2026-08-15 — visible signers annotation on flattened PDFs

Given in the implementation specification that supplied the owner's final
layout reference and required a tenant flag defaulting off.

> Owner ruling 2026-08-15 sanctions this visible artifact change.

## 2026-08-07 — storing signature ink per document

Reverses the 2026-08-01 rule that signature ink is never stored separately.
Originally posted on the pull request adding signature records.

> Potwierdzam moją decyzję z 2026-08-07: przechowujemy tusz podpisów per
> dokument (ustawienie tenanta, ON dla naszego tenanta), odwracając moją regułę
> z 2026-08-01 — pod przyszłe „Uaktualnij źródło".

## 2026-08-09 — PAdES organization seal and Tryb dat

Originally posted on the pull request adding the PAdES seal.

> Potwierdzam moje decyzje z 2026-08-09: (1) podpisane PDF-y dostają osadzoną
> pieczęć organizacji PAdES (za flagą tenanta, domyślnie OFF); (2) nowe
> ustawienie „Tryb dat" — domyślnie daty deklarowane (signingTime pieczęci =
> wpisana data podpisania + bieżąca godzina), opcjonalnie daty rzeczywiste;
> prawdziwy czas pieczęci tylko w bazie.
