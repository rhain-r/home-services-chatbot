# Summit Heating, Air & Roofing — Concierge Knowledge Base

This file is the concierge's single source of truth. If a fact is not written here, the agent must say it does not know and offer the office. Keep it current; keep it factual. This is a fictional company used for the demo; every number below is sample data.

## Company

- Name: Summit Heating, Air & Roofing ("Summit")
- What we do: residential heating and cooling repair, maintenance and installation, plus roof repair, replacement and storm-damage work.
- Family-owned since 2009. 34 employees, 14 service trucks.
- Office: 4120 Brighton Blvd, Denver, CO 80216
- Phone: (303) 555-0148 (calls and texts). Email: hello@summit-hvac.example
- Booking link: https://cal.com/summit-hvac/book
- Hours: office and scheduling Monday to Saturday, 7:00 to 19:00 Mountain Time. Emergency repairs 24/7, including holidays.
- Licensed, bonded and insured in Colorado. Technicians are NATE-certified and background-checked. We do not name specific license numbers in chat; the office provides them on request.
- Reviews: 4.9 average across 1,200+ public reviews.
- Languages: English and Spanish (office staff and several technicians).

## Service area

We serve the Denver metro area, roughly within 35 miles of downtown Denver: Denver, Aurora, Lakewood, Littleton, Englewood, Centennial, Parker, Highlands Ranch, Arvada, Westminster, Thornton, Broomfield, Golden, Wheat Ridge, Commerce City, Brighton, Castle Rock.

Not served: Colorado Springs, Fort Collins, Boulder County beyond Broomfield, mountain towns, and anywhere outside Colorado. If a visitor is outside the area, say so plainly and early. We do not have referral partners to recommend.

## Services

### Heating and cooling repair
- Diagnostic visit: $89 flat, Monday to Saturday 7:00 to 19:00. Waived if you approve the repair on the same visit.
- Emergency visit (after hours, Sundays, holidays): $149 flat. Waived the same way. Comfort Club members pay the standard $89 at any hour.
- Same-day service is available most days when you book before 14:00; otherwise next business day. Emergencies (no heat below freezing, no cooling for an at-risk household, water leaking from equipment) are dispatched the same day, any hour.
- Every repair is quoted flat-rate after diagnosis and before any work starts. No hourly billing.
- Typical repair ranges (for orientation only; the technician quotes the exact price on site):
  - Capacitor: $180 to $300
  - Ignitor or flame sensor: $200 to $350
  - Refrigerant leak find-and-recharge: $250 to $600 (older R-22 systems cost more and are usually better replaced)
  - Blower motor: $450 to $900
  - Control board: $400 to $800
- Repair warranty: 1 year on parts and labor.
- Brands: we service all major residential brands (Carrier, Trane, Lennox, Rheem, Goodman, Bryant, American Standard, Daikin, Mitsubishi and others).

### Maintenance: Comfort Club
- $19/month per home, cancel any time after the first 12 months.
- Includes: spring AC tune-up and fall furnace tune-up, priority scheduling, 15% off all repairs, no after-hours fee, annual roof visual check, reminders handled for you.
- One-off tune-up without the plan: $129 per system.

### Installation and replacement
- Free in-home estimate (60 to 90 minutes). We size the system to the house; we do not quote installs over chat.
- Typical installed ranges (Denver metro, standard single-family home):
  - Central AC: $6,500 to $12,500
  - Gas furnace: $4,500 to $9,000
  - Heat pump (heating and cooling): $9,000 to $16,000, before rebates
  - Full system (furnace + AC) replaced together: $10,000 to $19,000
- Financing: 0% APR for 18 months, or fixed-rate terms up to 120 months, with approved credit through our lending partner. Applications take about 10 minutes; the estimator handles it.
- Rebates: Xcel Energy and federal tax credits often apply to high-efficiency and heat-pump systems; the estimator confirms current amounts. Do not quote rebate dollar figures in chat.
- Timeline: most installs are completed within 3 to 7 days of the estimate; emergency replacements (no heat in winter) can usually be done within 48 hours.
- Install warranty: 10-year manufacturer parts warranty (registered for you) plus 2-year Summit labor warranty.

### Roofing
- Free roof inspection with a written report and photos, usually within 2 business days (same day after major storms is not guaranteed).
- Repairs: $350 to $1,500 typical (missing shingles, flashing, small leaks).
- Full replacement, asphalt shingle, typical 2,000 sq ft home: $9,500 to $18,000. Metal roofing: $22,000 to $40,000.
- Storm and hail damage: we document the damage, meet the insurance adjuster on site, and handle the claim paperwork. We do not promise what an insurer will approve.
- Workmanship warranty: 10 years. Manufacturer shingle warranties: 25 to 50 years depending on product.
- Timeline: most replacements are done in 1 to 2 days once materials arrive (usually within 2 weeks).

### Emergencies and safety (always follow)
- Smell of gas, or a carbon-monoxide alarm sounding: tell the visitor to leave the house immediately, not to touch light switches or appliances, and to call their gas utility's emergency line or 911 from outside. Only after that, offer to escalate to our dispatcher. Never troubleshoot a gas smell in chat.
- No heat when it is below freezing, no cooling for infants, elderly or medically vulnerable people, or water actively leaking from equipment or the roof: treat as an emergency; route to the dispatcher (escalate_to_human, urgency high). The on-call dispatcher calls back within 15 minutes, 24/7.
- Electrical burning smell from the furnace: switch the system off at the thermostat and the breaker, then book an emergency visit.

## Who we are a fit for

- Homeowners in the service area. Property managers and landlords who can approve work.
- Renters: we are happy to help, but the owner or property manager must authorise and pay for the work. Offer to send the renter information they can forward, and ask for the owner's contact if they have it.

Not a fit: commercial refrigeration, walk-in coolers, boilers over 400,000 BTU, mobile-home furnaces, plumbing, electrical panel work, appliance repair, window units. Say so kindly; we have no referral list.

## How booking works

1. Visitor books online (link above) or the office calls back within one business hour during office hours.
2. Confirmation by text and email with a 2-hour arrival window.
3. Technician texts when 30 minutes away. Technicians wear shoe covers and clean up.
4. Diagnosis, flat-rate quote, approval, repair. Payment by card, check, or financing for larger work.

Meeting types (for trigger_calendar):
- "Service call": repair diagnostic. Default for anything broken.
- "Free estimate": system replacement, new installation, or roofing replacement.
- "Roof inspection": leaks, storm or hail damage, selling a home.
- "Tune-up": seasonal maintenance or Comfort Club enrolment visit.
- Emergencies are NOT booked through the calendar; use escalate_to_human with urgency high so the dispatcher calls.

Required to book: name, mobile number (confirmation and arrival texts go there) and ZIP code (service area and routing). Email is optional; offer it only if they want an email copy. Ask for the street address only if the visitor offers it; the office confirms it on the confirmation call.

Arrival windows are 2 hours long, Monday to Saturday 7:00 to 19:00. Same-day windows exist most days when booked before 14:00. Offer the windows the booking tool returns; never invent times.

## 30-second checks before we send a truck (offer once, never insist)

Many "broken" systems are a $0 fix. Offer ONE check that fits the symptom, then move on whatever the answer:
- AC blowing warm air or not starting: is the thermostat set to Cool and lower than the room temperature, and is the outdoor unit running? If the outdoor unit is silent, flip its breaker off and on once. If it stays dead, it is usually a capacitor or contactor ($180 to $300).
- AC running but weak airflow, or ice on the pipes: a clogged filter is the most common cause. Turn the system off, replace the filter, and give it two hours to thaw before restarting.
- Furnace not starting: thermostat set to Heat and above room temperature, furnace switch (looks like a light switch near the unit) on, and the filter not clogged. Many furnaces also have a small door safety switch that must be closed.
- Furnace runs then shuts off (short cycling): usually a dirty flame sensor or a clogged filter; safe to book, not an emergency unless there is no heat below freezing.
- Thermostat blank: try fresh batteries before anything else.
- Water around the indoor unit in summer: a clogged condensate drain; switch the system off to stop the drip and book a service call.
Do NOT offer checks for gas smell, CO alarms, burning smells, or sparks; those are emergencies.

## While you wait (for emergencies, after the dispatcher has been notified)
- No heat in freezing weather: keep one room warm (space heater or fireplace, never a gas oven), open cabinet doors under sinks so pipes get room air, and let faucets drip.
- No cooling with vulnerable people in the home: close blinds, run fans, stay on the lowest floor, drink water; go somewhere cool if it climbs above 85°F indoors.
- Active roof leak: bucket under the drip, move electronics, do not go on the roof.
- Water leaking from equipment: switch the system off at the thermostat.

## Results we can cite

- Average arrival within the promised window: 96% of visits last year.
- Average same-day dispatch time in summer: 3 hours 40 minutes from booking to technician on site.
- 1,200+ public reviews, 4.9 average.
- Do not name individual customers. Do not quote other numbers.

## Pricing FAQ

- Do you offer discounts or coupons? The concierge cannot offer discounts. The only standing benefits are the Comfort Club (15% off repairs, no after-hours fee) and the waived diagnostic fee when a repair is approved the same visit. Seasonal promotions, if any, are confirmed by the office; do not invent one.
- Is the estimate really free? Yes, for replacements and roofing. Diagnostic visits for repairs are $89 ($149 emergency), waived with an approved repair.
- Do you price-match? No formal price-match. If another quote is lower, we are glad to explain what ours includes (permits, disposal, warranty registration, labor warranty) so the visitor can compare properly.
- Payment: card, check, ACH, financing. Deposits: 30% on installs and roofing, balance on completion.

## Common objections and approved responses (facts only)

- "Another company charges less for the visit." Fair. Ours is $89 and it is waived if you go ahead with the repair, and every quote is flat-rate before work starts. If the other company's visit fee is lower but they bill hourly, the totals often end up close; worth asking them.
- "Can't I just get a handyman?" For some things, yes. For anything involving gas, refrigerant or electrical on an HVAC system, Colorado requires licensed work, and unlicensed repairs can void the manufacturer warranty. Say this once, without lecturing.
- "I'll just replace it myself / buy online." Equipment bought online usually carries no manufacturer warranty without a licensed install. We are happy to give a free estimate so the comparison is real.
- "Your replacement quote is higher than expected." Ask what they were expecting and what the other quote includes. Offer the free estimate (sizing matters), financing at 0% for 18 months, and the option of a repair to buy time if the system is under ~12 years old.
- "We had a bad experience with a contractor before." Ask what happened. Point to the flat-rate quote before work, the 2-hour window with a 30-minute text, the labor warranty, and the public reviews.
- "Is it really 24/7?" Yes. The emergency visit fee is $149 ($89 for Comfort Club members), and the dispatcher calls back within 15 minutes.

## Things the concierge must NOT claim

- An exact repair price before a technician has diagnosed the system.
- An install or roofing price without an in-home estimate.
- A specific arrival time; only the office confirms the 2-hour window.
- Rebate or insurance-claim amounts.
- That we serve any area not listed above.
- Any discount, coupon or promotion not listed above.
- That a gas smell or CO alarm is safe to investigate; always give the safety instruction first.
