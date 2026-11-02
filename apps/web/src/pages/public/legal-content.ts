export const PRIVACY_CONTACT = "keybeen.webdeveloper@gmail.com";
export type LegalSection = { id: string; title: string; paragraphs: string[] };
export const termsSections: LegalSection[] = [
  {
    id: "who",
    title: "1. Using PaServe",
    paragraphs: [
      "PaServe helps shops manage menus, team access and the flow of orders from customer to cashier to kitchen. These Terms cover use of the platform. The shop is responsible for the goods it sells, prices, preparation, food safety, taxes, receipts, fulfilment and customer remedies.",
      "PaServe is independently operated by Kevin D. Ramos, using the developer alias 404NeuronNotFound. Questions about the platform or these Terms may be sent to keybeen.webdeveloper@gmail.com. A shop’s own contact details appear in its public shop information when supplied.",
    ],
  },
  {
    id: "age",
    title: "2. Business accounts are for adults",
    paragraphs: [
      "You must be at least 18 to create or use an owner or staff account, including Admin, Manager, Cashier and Kitchen accounts. This is PaServe’s account policy, not a statement that Philippine privacy law sets a universal age of digital consent. A verified email or Google account proves access to that account; it does not verify your age.",
      "Do not create an account for a child, share an adult’s credentials with a child, or misstate your eligibility. We do not offer a parental-consent route for business accounts. If you are under 18, do not register. If an underage account is suspected, contact us for review; access may be restricted and unnecessary information removed after review, subject to lawful retention.",
      "Customers do not need an account to view a menu or order. A child using a public ordering page should ask a parent or guardian to supervise and handle the purchase. Shops must apply any legal restrictions on their products and verify eligibility at fulfilment. PaServe’s age declaration is not proof of eligibility to buy age-restricted goods.",
    ],
  },
  {
    id: "account",
    title: "3. Your account and your team",
    paragraphs: [
      "Use accurate account information and an email address you control. Keep passwords, verification codes and sessions private. Use separate accounts and the appropriate role for each team member. Sign out on shared devices and report suspected unauthorised access promptly.",
      "You must be authorised to represent any shop you create or manage. Shop owners are responsible for lawful team access and promptly removing access that is no longer needed. An invitation does not override the adult-account policy.",
    ],
  },
  {
    id: "orders",
    title: "4. Orders, payment and consumer rights",
    paragraphs: [
      "Review the shop, items, modifiers, quantities and displayed total before submitting an order. An order request is subject to shop confirmation and availability. Follow the shop’s instructions for payment; a status shown in PaServe is not a bank or payment-provider guarantee.",
      "For incorrect items, cancellations, refunds, allergies or food-safety concerns, contact the shop first. Do not place essential allergy or medical information only in an order note; confirm directly with shop staff. Shops must resolve complaints in accordance with applicable Philippine consumer laws. Nothing in these Terms removes mandatory consumer rights or permits a blanket no-refund policy where a remedy is required by law.",
    ],
  },
  {
    id: "conduct",
    title: "5. Keep the service safe and lawful",
    paragraphs: [
      "Do not submit fraudulent orders, impersonate another person, harass others, upload illegal or infringing material, expose another person’s private information, attempt to bypass permissions, or interfere with the service. Use only content you have the right to upload.",
      "Do not use free-text fields or uploads for government IDs, card details, passwords, children’s information or other sensitive information that the order does not need. Shops remain responsible for lawful products, advertising, employment practices and their own privacy notices.",
    ],
  },
  {
    id: "privacy",
    title: "6. Privacy and communications",
    paragraphs: [
      "The separate Privacy Notice explains the personal information used to operate PaServe and how to exercise your rights. Acknowledging that notice is not blanket consent to marketing or unrelated processing. Account verification, security and recovery messages are service communications.",
      "We record the policy version and the time you accept these Terms, acknowledge the Privacy Notice and declare adult eligibility when a new account is created. We do not treat pre-existing accounts as having accepted these new declarations.",
    ],
  },
  {
    id: "availability",
    title: "7. Availability, responsibility and suspension",
    paragraphs: [
      "The service may be interrupted by maintenance, connectivity or provider failures. Keep appropriate business records and verify important orders and payment details. We do not promise uninterrupted availability or that PaServe alone satisfies a shop’s legal, accounting or tax obligations.",
      "Access may be restricted for security, unlawful use or material breaches of these Terms. Where practical, we will explain the reason and provide a way to request review, unless doing so would compromise security or conflict with law. Contact us to request account closure and discuss the effect on shop records and team access.",
      "Each party remains responsible for its own acts and omissions under applicable law. Nothing here excludes responsibility that cannot lawfully be excluded, waives data-subject rights, or prevents complaints to regulators or lawful remedies.",
    ],
  },
  {
    id: "changes",
    title: "8. Changes and Philippine law",
    paragraphs: [
      "Philippine law governs these Terms, without removing mandatory protections that apply to you. Contact us to discuss a concern; you may also approach the appropriate authority or court. These Terms do not require you to give up a right to complain to the National Privacy Commission or consumer authorities.",
      "Updates will show a new version and date. Material changes affecting your rights or processing will be communicated through an appropriate channel; any new consent needed by law must be obtained separately. Contact keybeen.webdeveloper@gmail.com for questions or a copy of the version applicable to your account.",
    ],
  },
];

export const privacySections: LegalSection[] = [
  {
    id: "responsibility",
    title: "1. Who handles your information",
    paragraphs: [
      "This notice covers PaServe’s public website, business accounts, verification and recovery, and shop ordering features. PaServe is independently operated by Kevin D. Ramos, using the developer alias 404NeuronNotFound. For platform privacy requests, contact Kevin D. Ramos at keybeen.webdeveloper@gmail.com.",
      "A shop decides how it uses customer orders and staff information for its business and is responsible for its own processing. PaServe handles platform-account and security information for operating the service, and processes shop information to provide the shop’s requested tools. Responsibility depends on who determines the purpose and means of each activity; hosting information does not remove either party’s legal obligations. Contact the shop about its transactions, and us about platform processing or help routing a request.",
    ],
  },
  {
    id: "information",
    title: "2. Information the service uses",
    paragraphs: [
      "Business accounts: first and last name, email, password hash or linked Google identifier, email-verification state, shop memberships and roles, session records, and walkthrough progress. New registrations also record the policy version, acceptance and acknowledgement times, and an adult self-declaration. We do not request a date of birth or identity document for this declaration. Your specific permission to record the adult declaration is limited to account eligibility. You can withdraw it through our privacy contact; we will explain any effect on account eligibility and any lawful retention before acting.",
      "Shop and order activity: shop details, uploaded menu images and descriptions, team invitations, products and options, table references, order contents and notes, workflow status, and recorded payment method, amount or reference where used. Customer ordering does not require a PaServe account. Do not include unnecessary personal or sensitive information in notes or uploads.",
      "Security and support: request and error diagnostics, identifiers, timestamps, and the information you choose to include in a support request. Hosting, email, identity and bot-protection providers may also process technical information such as IP address, browser and delivery events. Never email us passwords, verification codes or full payment-card details.",
    ],
  },
  {
    id: "purposes",
    title: "3. Purposes and lawful grounds",
    paragraphs: [
      "We use account and order information to provide the service you request: create and authenticate accounts, verify email ownership, recover or secure access, manage authorised shop access, and route and display orders. Contract-related processing, compliance with legal obligations, and appropriate legitimate interests such as preventing fraud may apply under Section 12 of the Data Privacy Act, depending on the activity.",
      "Legitimate interests require assessment against your rights and freedoms, not an unrestricted right to use information. Where consent is the appropriate legal basis, it must be specific and informed and can be withdrawn. Sensitive information requires an applicable ground under Section 13; ordinary account acceptance is not permission to process arbitrary sensitive data.",
      "The required Privacy Notice acknowledgement records that the notice was presented. It is not consent to advertising, selling information or unrelated purposes. This flow does not enrol you in marketing. A future optional purpose requiring consent must have a separate choice.",
    ],
  },
  {
    id: "recipients",
    title: "4. Access, service providers and overseas processing",
    paragraphs: [
      "Authorised shop staff can access information needed for their assigned role. Platform personnel may access information when necessary for support, security or legal duties. Disclosures to authorities require an applicable lawful basis; a request alone does not justify unrestricted disclosure.",
      "Supabase supports email verification, Google identity verification and data/storage services; Brevo delivers service emails through Supabase SMTP. Google processes information when you choose Google sign-in. Cloudflare Turnstile may handle a security challenge when required. Infrastructure and hosting providers process the information needed to run and protect the service.",
      "These services may process information outside the Philippines. Appropriate provider agreements, access restrictions and security safeguards are required; overseas processing does not remove accountability under Philippine law. Contact us for information about the providers, processing locations and safeguards relevant to your request.",
    ],
  },
  {
    id: "storage",
    title: "5. Browser storage and automated checks",
    paragraphs: [
      "PaServe uses session cookies and browser storage for sign-in, selected appearance, shop and ordering continuity, and first-use walkthroughs. Shared-device sessions last up to 8 hours; choosing Keep me signed in allows a session of up to 7 days. These are session lifetimes, not promises that all related server records are erased at expiry.",
      "Rate limits, verification checks, role permissions and bot detection may restrict a request automatically. They help prevent abuse and protect accounts; they do not assess creditworthiness or employment suitability. If access appears wrongly blocked, contact us for review. You can clear browser storage, although this may sign you out or remove local order and interface preferences.",
    ],
  },
  {
    id: "retention",
    title: "6. Retention, security and disposal",
    paragraphs: [
      "Account information is retained while needed to provide the account and resolve account-related obligations. Shop transactions and payment records may need to remain for the shop’s applicable accounting, tax, dispute or other legal obligations. Verification and security records are kept only for a justified operational or legal need. Backups and provider logs may follow separate retention cycles.",
      "There is currently no published fixed automatic deletion schedule for all categories. Contact us for the applicable period or criteria and to request deletion or restriction. We must assess what can be erased, explain any lawful retention, and remove or anonymise information when its purpose and required retention end. Account closure does not automatically erase a shop’s legally required records.",
      "Safeguards include password hashing, role and shop access controls, protected session handling and verification of sensitive account changes. No service can promise absolute security. Report suspected exposure promptly; incidents must be assessed and affected people and the NPC notified where legally required.",
    ],
  },
  {
    id: "children",
    title: "7. Children and public ordering",
    paragraphs: [
      "Business accounts are restricted to people aged 18 or older under PaServe policy. The adult declaration is self-reported; a verified inbox or Google account is not proof of age. We do not intentionally invite children to register or offer a parent-approved business-account flow.",
      "Young customers should use public ordering with a parent or guardian who handles the purchase. Keep children’s names, age, school, contact details and other unnecessary information out of order notes. Shops must assess and protect children’s data they receive; supervision is not blanket consent to collect it.",
      "If you believe a child has registered or provided unnecessary personal information, email our privacy contact so we can review access and arrange appropriate removal or restriction, subject to lawful retention. Explain the concern without attaching a child’s identity documents.",
    ],
  },
  {
    id: "rights",
    title: "8. Your choices, rights and requests",
    paragraphs: [
      "Subject to the conditions and exceptions in Philippine law, you may ask to be informed, access your personal information, correct inaccuracies, object to processing, withdraw consent where relied upon, seek blocking or erasure, and receive portable information where applicable. You may seek damages where legally available and lodge a complaint with the National Privacy Commission.",
      "Email keybeen.webdeveloper@gmail.com with the subject PaServe privacy request. Tell us which account or shop and what you want to access, correct, delete or restrict. We will verify authority proportionately before disclosure or changes. Do not send a password, code or government ID in the initial request. If more verification is necessary, we will explain why and how to provide the minimum information securely.",
      "We will explain the outcome, any lawful limitation or retention requirement, and the applicable response process. You may contact the NPC through privacy.gov.ph independently of our support process. A shop may need to act on transaction records it controls; we will help identify the appropriate party.",
    ],
  },
  {
    id: "updates",
    title: "9. Updates to this notice",
    paragraphs: [
      "The version and date appear at the top. We will communicate material changes through an appropriate channel and obtain fresh consent where a new consent-based purpose requires it. Current acknowledgement does not authorise undisclosed future uses. Contact our privacy email with questions about a previous notice or the processing that applies to your information.",
    ],
  },
];
