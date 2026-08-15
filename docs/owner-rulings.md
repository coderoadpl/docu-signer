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

(Gloss: Together's review wall gates the owner — and that is fine; adopt the
same here, production promotions are performed by the owner.)

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
