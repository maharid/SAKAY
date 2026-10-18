# SAKAY: corrections the policy document needs

*Appendix B - Operational Policies and Business Rules* contradicts itself or itself cites the wrong rule in a few places. The system follows the evident intent in each case (the owner's decision PI-09 = A and the decisions named below). This list is so the document can be corrected to match the system, or so the owner can say that the system should follow the text as written. Nothing here is a defect in the code.

Written 2026-10-18. Every item points at the decision that records the choice (`docs/policy-decisions.md`).

## 1. Wrong cross-references (implemented by intent; PI-09 a - e)

| # | The text says | It should say | Where it matters |
|---|---|---|---|
| 1 | Rule 18.6 cites "Passenger Strike System (Section 19)" | Section 20 | `violation_catalog.source_rule` carries the corrected reference |
| 2 | Section 21 cites "Rules 6.4, 18.4" for overcharging | Rules 6.4 and 18.5 (18.4 is the unfounded dispute) | `DRV_OVERCHARGING`, `PAX_UNFOUNDED_DISPUTE` |
| 3 | Rule 14.7 says "consistent with Rule 6.1" | Rule 6.1.3 | the Shared Trip fare |
| 4 | Rule 29.8 says "Rule 11.1 / 11.2 applies" | Rules 12.1 / 12.2 (and 12.3 / 12.4): cancellations, not the boarding check | passenger and driver cancellation strikes |
| 5 | Rule 13 has no "13.1" label (its first paragraph is unnumbered) | number the first paragraph 13.1 | references to "13.2" onward are unchanged |

## 2. Rules that overlap or say the same thing twice (PI-09 f)

| # | Rules | What the system does |
|---|---|---|
| 6 | 7.4 and 7.5 | one ranking, one set of tie-breaks (the dispatch engine), so the overlap has no effect |
| 7 | 3.1 and 3.10 | one rule: a driver chooses the active TODA while Offline, and only a verified affiliation can be chosen |

## 3. Penalties the text mentions but does not define (PI-09 g, h)

| # | Rule | The text says | What the system uses (decision D2, Batch 3) |
|---|---|---|---|
| 8 | 12.9 | booking abusers are restricted "under the Passenger Strike System", but Section 20 defines no booking-abuse consequence | a review flag at three cancelled bookings in 24 hours; a strike (2 points) only after an administrator confirms |
| 9 | 5.7, 29.15, 29.16, 27.5 | "applicable strikes" without a count | 1 point per administrator-confirmed instance, each with its own catalog code |

## 4. Figures where the text disagrees with itself

| # | Rules | The text | What the system uses | Decision |
|---|---|---|---|---|
| 10 | 6.5, 14.2, 14.4 | matching continues "while less than 50%" / "50% or less" / "the 50% cutoff" | less than 50% | PI-10 = A |
| 11 | 10.1, 10.2, 8.5 | the pickup zone is 10 m, 5 m beyond it for 15 s, and "about 20 m" | one pickup zone of 25 m (fix at most 45 s old, at most 30 m of error), with the 5 m / 15 s tolerance of 10.2 | PI-06; G-23 |
| 12 | 13.2, Section 16 | the destination check is "within 20 m" but Section 16 never defines it | the driver may finish at 90% of the way to the pin (and the end is checked by the database) | PI-07; section 13 (D-TF-1); G-23 |
| 13 | 7.x, dispatch appendix | the longest search is not stated in the rules; the appendix says 10 minutes | 10 minutes by default, editable between 1 and 30 minutes | PI-12; D-2 (2026-10-11); G-23 |

## 5. Rules that cannot be enforced by software (kept as instructions)

| # | Rules | Why | What the system does |
|---|---|---|---|
| 14 | 11.2 - 11.4 | the system cannot see who boards the tricycle | shows the driver the passenger's first name and the pickup before boarding (11.1); a wrong boarding is handled between the people and, if needed, reported to an administrator, with no automatic strike (G-16) |
| 15 | 8.7, 27.2, 27.6, 27.7 | a strike must follow a decision by a person, not a signal | each raises a review flag or a report; the strike follows administrator confirmation (G-15) |
| 16 | 3.3 | the operator is not a user and every contact goes through the TODA Administrator | the operator's name is recorded from the MTOP permit; no phone number is collected (G-14) |

## 6. What the text should say now that the system does more

| # | Rule | Suggested wording |
|---|---|---|
| 17 | 4.2 | "...directed to password recovery, which sends a one-time code to the registered mobile number." (recovery exists since 2026-10-18, G-3) |
| 18 | 6.4 | add: "or asks for payment in advance, a deposit, or payment outside the app" (the report category now says so, G-18) |
| 19 | 7.9 | add: "the TODA Administrator or the LGU Administrator may confirm the pattern; the confirmation is recorded as Repeated Refusal" (G-11) |
| 20 | 29.18 | add: "a substitute vehicle is approved for 1 to 7 days by the TODA Administrator and then the LGU Administrator; the registered vehicle returns by itself" (G-10b) |
