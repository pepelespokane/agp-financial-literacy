/* Game of Life ("Money Journey") - game data. Loaded before app.js.
   Source: Lesson Plans/GameofLife kit (ECU-GameofLife.xlsx + card docs). No em dashes. */

/* Life scenarios: job, salary (gross), status M/S, kids, spouseSalary, pet, net (take-home per month after 401k+tax) */
var SCENARIOS = [
  { job: "Doctor", salary: 250000, status: "M", kids: 2, spouse: 0, pet: true, net: 13522 },
  { job: "Attorney", salary: 150000, status: "M", kids: 1, spouse: 47000, pet: true, net: 10966 },
  { job: "Software Developer", salary: 130000, status: "S", kids: 0, spouse: 0, pet: false, net: 7029 },
  { job: "Physical Therapist", salary: 99000, status: "M", kids: 3, spouse: 52000, pet: false, net: 8404 },
  { job: "Chiropractor", salary: 78000, status: "M", kids: 2, spouse: 49000, pet: true, net: 7067 },
  { job: "Architect", salary: 95000, status: "S", kids: 1, spouse: 0, pet: true, net: 5285 },
  { job: "Nurse Practitioner", salary: 125000, status: "M", kids: 3, spouse: 0, pet: false, net: 6956 },
  { job: "Registered Nurse", salary: 90000, status: "M", kids: 2, spouse: 38000, pet: true, net: 7123 },
  { job: "Digital Analyst", salary: 92000, status: "M", kids: 1, spouse: 42000, pet: false, net: 7457 },
  { job: "Elementary Teacher", salary: 52000, status: "M", kids: 2, spouse: 75000, pet: true, net: 7067 },
  { job: "Hotel General Manager", salary: 87000, status: "S", kids: 0, spouse: 0, pet: false, net: 4839 },
  { job: "Operations Manager", salary: 100000, status: "S", kids: 2, spouse: 0, pet: true, net: 5564 },
  { job: "Graphic Designer", salary: 57000, status: "M", kids: 1, spouse: 71000, pet: true, net: 7123 },
  { job: "Paralegal", salary: 65000, status: "M", kids: 2, spouse: 55000, pet: false, net: 6677 },
  { job: "Production Manager", salary: 70000, status: "S", kids: 0, spouse: 0, pet: false, net: 3893 },
  { job: "Police Officer", salary: 77000, status: "M", kids: 3, spouse: 61000, pet: true, net: 7680 },
  { job: "TV Reporter", salary: 57000, status: "M", kids: 2, spouse: 81000, pet: false, net: 7680 },
  { job: "Social Worker", salary: 65000, status: "S", kids: 0, spouse: 0, pet: true, net: 3614 },
  { job: "Firefighter / EMT", salary: 50000, status: "M", kids: 2, spouse: 74000, pet: true, net: 6900 },
  { job: "Dental Assistant", salary: 47000, status: "M", kids: 2, spouse: 81000, pet: false, net: 7123 },
  { job: "Dentist", salary: 170000, status: "M", kids: 4, spouse: 0, pet: true, net: 9462 },
  { job: "Chef", salary: 59000, status: "S", kids: 0, spouse: 0, pet: false, net: 3280 },
  { job: "Marketing Manager", salary: 84000, status: "M", kids: 2, spouse: 57000, pet: true, net: 7847 },
  { job: "Accountant", salary: 85000, status: "S", kids: 0, spouse: 0, pet: true, net: 4728 },
  { job: "Computer Engineer", salary: 122000, status: "M", kids: 1, spouse: 44000, pet: true, net: 9239 },
  { job: "IT Specialist", salary: 110000, status: "S", kids: 0, spouse: 0, pet: false, net: 5946 },
  { job: "Business Manager", salary: 90000, status: "M", kids: 3, spouse: 0, pet: true, net: 5718 },
  { job: "Financial Analyst", salary: 93000, status: "M", kids: 2, spouse: 51000, pet: true, net: 8014 },
  { job: "Sales Manager", salary: 135000, status: "S", kids: 1, spouse: 0, pet: false, net: 7299 },
  { job: "Project Manager", salary: 94000, status: "M", kids: 3, spouse: 0, pet: true, net: 5973 },
  { job: "Veterinarian", salary: 120000, status: "S", kids: 0, spouse: 0, pet: true, net: 6488 },
  { job: "Pilot", salary: 115000, status: "M", kids: 2, spouse: 0, pet: true, net: 6399 }
];

/* Housing bundles insurance + repairs + utilities with the home choice */
var HOUSING = [
  { name: "Small apartment (1 bed)", rent: 1300, ins: 25, repairs: 0, util: 150, note: "renters insurance, no repairs" },
  { name: "Large apartment (3 bed)", rent: 1800, ins: 35, repairs: 0, util: 200, note: "renters insurance, no repairs" },
  { name: "Small house (1,500 sq ft)", rent: 2150, ins: 150, repairs: 200, util: 400, note: "HOA, repairs, full utilities" },
  { name: "Large house (2,500 sq ft)", rent: 3600, ins: 250, repairs: 300, util: 500, note: "HOA, repairs, full utilities" }
];

/* Food combines eating out + groceries (inverse relationship baked in) */
var FOOD = [
  { name: "Thrifty", eatout: 150, groceries: 400, note: "cook at home, rarely eat out" },
  { name: "Low", eatout: 300, groceries: 550, note: "mostly cook, go out sometimes" },
  { name: "Moderate", eatout: 450, groceries: 750, note: "mix of cooking and eating out" },
  { name: "Luxury", eatout: 700, groceries: 1100, note: "eat out often" }
];

var TRANSPORT = [
  { name: "Bus pass", cost: 55, car: false },
  { name: "Metro / transit", cost: 90, car: false },
  { name: "Compact car (used)", cost: 225, car: true },
  { name: "Compact car (new)", cost: 300, car: true },
  { name: "Mid-size car (used)", cost: 325, car: true },
  { name: "Mid-size car (new)", cost: 385, car: true },
  { name: "Truck / SUV (used)", cost: 425, car: true },
  { name: "Truck / SUV (new)", cost: 500, car: true },
  { name: "Luxury car (used)", cost: 700, car: true },
  { name: "Luxury car (new)", cost: 785, car: true }
];

/* Home costs = furniture + clothing + personal care + health */
var HOME_COSTS = [
  { name: "Low", cost: 300 },
  { name: "Moderate", cost: 600 },
  { name: "Luxury", cost: 900 }
];

/* Lifestyle = hobbies/activities + travel */
var LIFESTYLE = [
  { name: "Low", cost: 250, note: "one trip a year" },
  { name: "Moderate", cost: 500, note: "a couple trips a year" },
  { name: "Luxury", cost: 1000, note: "several trips a year" }
];

/* fixed monthly costs everyone pays */
var FIXED = { phone: 150, internet: 75, entertainment: 100, subs: 75 };  // gas + auto insurance added only if they own a car
var CAR_COSTS = { gas: 150, insurance: 100 };
var CHILD_MONTHLY = 1367;   // care 900 + activities 100 + costs 200 + education fund (2000/yr)
var PET_MONTHLY = 125;

/* spouse debt dice: roll -> monthly payment */
var DEBT_ROLLS = { 1: 0, 2: 0, 3: 0, 4: 167, 5: 200, 6: 350 };
var DEBT_DETAIL = { 0: "No debt", 167: "$15,000 debt over 10 years", 200: "$30,000 debt over 20 years", 350: "$60,000 debt over 25 years" };

/* Crystal Ball deck. k: inc=income up, dec=income down, cost=expense up, cut=expense down, divorce, child */
var CRYSTAL = [
  { t: "You earned a raise at work.", k: "inc", a: 500 },
  { t: "You earned a promotion.", k: "inc", a: 400 },
  { t: "You created a new invention.", k: "inc", a: 1000 },
  { t: "You launched a side hustle.", k: "inc", a: 700 },
  { t: "You won a talent show.", k: "inc", a: 500 },
  { t: "You won a community award.", k: "inc", a: 250 },
  { t: "You won a lawsuit.", k: "inc", a: 750 },
  { t: "You made a great investment.", k: "inc", a: 1000, lesson: "Boring, diversified investing pays off over time." },
  { t: "You received an inheritance.", k: "inc", a: 750 },
  { t: "You earned a graduate degree.", k: "inc", a: 1250 },
  { t: "You published a book.", k: "inc", a: 750 },
  { t: "You earned a new certification.", k: "inc", a: 400 },
  { t: "You secured a government grant.", k: "inc", a: 1000 },
  { t: "You qualified for a tax exemption.", k: "inc", a: 250 },
  { t: "You worked extra hours.", k: "inc", a: 500 },
  { t: "You ran for public office and won.", k: "inc", a: 1500 },
  { t: "You won a sporting contest.", k: "inc", a: 250 },
  { t: "Someone in your household started working.", k: "inc", a: 2750 },
  { t: "You won free meals for a year.", k: "cut", a: 200 },
  { t: "You got hand-me-downs from family.", k: "cut", a: 150 },
  { t: "You lost your job.", k: "dec", a: 1750, lesson: "This is exactly why an emergency fund matters. Could you survive it?" },
  { t: "The IRS garnished your wages for back taxes.", k: "dec", a: 750, lesson: "Set aside for taxes so this never happens." },
  { t: "You needed major car repairs.", k: "cost", a: 200 },
  { t: "You lost a lawsuit.", k: "cost", a: 500 },
  { t: "You had gambling losses.", k: "cost", a: 150, lesson: "The house always wins. Gambling is not investing." },
  { t: "You made a bad investment.", k: "cost", a: 750, lesson: "Chasing hot tips burns money. Slow and diversified wins." },
  { t: "You have legal costs from a case against you.", k: "cost", a: 500 },
  { t: "You gave to charity.", k: "cost", a: 250 },
  { t: "You adopted a pet.", k: "cost", a: 150 },
  { t: "You pay child support.", k: "cost", a: 750 },
  { t: "A natural disaster damaged your property.", k: "cost", a: 1000, lesson: "Insurance plus an emergency fund soften the blow." },
  { t: "You ran up significant credit card debt.", k: "cost", a: 750, lesson: "Credit card interest is the fastest way to go backwards." },
  { t: "You have a child with special needs.", k: "cost", a: 750 },
  { t: "You had a serious medical issue.", k: "cost", a: 750, lesson: "Medical bills are a top cause of financial stress." },
  { t: "A family member has serious medical issues.", k: "cost", a: 500 },
  { t: "You had a dental emergency.", k: "cost", a: 250 },
  { t: "A pipe burst and flooded your home.", k: "cost", a: 150 },
  { t: "You renovated your home.", k: "cost", a: 500 },
  { t: "You added rooms to your home.", k: "cost", a: 600 },
  { t: "Your property taxes went up.", k: "cost", a: 300 },
  { t: "You needed emergency surgery.", k: "cost", a: 350 },
  { t: "Your home was broken into and insurance did not cover it all.", k: "cost", a: 250 },
  { t: "You added subscriptions.", k: "cost", a: 100, lesson: "Subscriptions quietly stack up. Audit them." },
  { t: "You took an international trip.", k: "cost", a: 500 },
  { t: "Gas prices went up.", k: "cost", a: 100 },
  { t: "Your kid started competitive travel sports.", k: "cost", a: 200 },
  { t: "You were diagnosed with a chronic disease.", k: "cost", a: 350 },
  { t: "You went through a divorce.", k: "divorce", a: 1000, lesson: "Divorce is one of the biggest financial setbacks there is." },
  { t: "You had another child.", k: "child" },
  { t: "You adopted a child.", k: "child" }
];

/* retirement assumptions (Stephen, 7/21/26): age 30 -> 65, 7% real return, 4% withdrawal */
var RETIRE = { years: 35, rate: 0.07, withdraw: 0.04 };
