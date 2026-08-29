import assert from "node:assert/strict";
import { parseChatGPTTriviaList, validateTriviaImportDraft } from "../lib/triviaImport.ts";

const chatGptFixture = `1. **Which planet is known as the Red Planet?**
   &#x20;A) Venus\\
   &#x20;**B) Mars**\\
   &#x20;C) Jupiter\\
   &#x20;D) Mercury&#x20;
2. **How many sides does an octagon have?**
   &#x20;A) 6\\
   &#x20;B) 7\\
   &#x20;**C) 8**\\
   &#x20;D) 10&#x20;
3. **Which artist released “Blinding Lights”?**
   &#x20;A) Drake\\
   &#x20;**B) The Weeknd**\\
   &#x20;C) Post Malone\\
   &#x20;D) Bruno Mars&#x20;
4. **What is the capital of Italy?**
   &#x20;A) Milan\\
   &#x20;**B) Rome**\\
   &#x20;C) Venice\\
   &#x20;D) Naples&#x20;
5. **Which animal is the fastest on land?**
   &#x20;A) Lion\\
   &#x20;**B) Cheetah**\\
   &#x20;C) Horse\\
   &#x20;D) Greyhound&#x20;
6. **Which movie features the character Shrek?**
   &#x20;A) Toy Story\\
   &#x20;B) Madagascar\\
   &#x20;**C) Shrek**\\
   &#x20;D) Ice Age&#x20;
7. **How many players from one team are on the field in soccer?**
   &#x20;A) 9\\
   &#x20;B) 10\\
   &#x20;**C) 11**\\
   &#x20;D) 12&#x20;
8. **Which of these is NOT a primary color in traditional painting?**
   &#x20;A) Red\\
   &#x20;B) Blue\\
   &#x20;C) Yellow\\
   &#x20;**D) Green**&#x20;
9. **Which ocean is the largest?**
   &#x20;A) Atlantic\\
   &#x20;B) Indian\\
   &#x20;**C) Pacific**\\
   &#x20;D) Arctic&#x20;
10. **Which superhero is Bruce Wayne?**
    &#x20;A) Superman\\
    &#x20;**B) Batman**\\
    &#x20;C) Spider-Man\\
    &#x20;D) Iron Man`;

const parsed = parseChatGPTTriviaList(chatGptFixture, {
  category: "Uncategorized",
  difficulty: "Easy",
});

assert.equal(parsed.drafts.length, 10);
assert.equal(parsed.ignoredLines.length, 0);
assert.deepEqual(parsed.drafts.map((question) => question.correctAnswer), [1, 2, 1, 1, 1, 2, 2, 3, 2, 1]);
assert.equal(parsed.drafts[0].question, "Which planet is known as the Red Planet?");
assert.deepEqual(parsed.drafts[0].answers, ["Venus", "Mars", "Jupiter", "Mercury"]);
assert.equal(parsed.drafts[0].category, "");
assert.equal(parsed.drafts[0].difficulty, "Easy");
assert.ok(parsed.drafts.every((draft) => validateTriviaImportDraft(draft, parsed.drafts, []).length === 0));

console.log("Trivia import fixture passed: 10 questions, 40 answers, 10 correct-answer markers.");
