type VocabularyInput={title:string;category:string;mode?:'automatic'|'material'};

export function isEnglishVocabulary(input:VocabularyInput) {
  if(input.mode==='material')return false;
  const title=input.title.replace(/\s+/g,'');
  return /영단어|영어.*(?:단어|어휘|동사|형용사|숙어)|(?:토익|토플|수능).*(?:단어|어휘)|english.*(?:vocab|words)|vocabulary/iu.test(title)
    ||(input.category==='외국어'&&/^(?:기초|초급|중급|고급)?(?:동사|형용사)(?:외우기|암기)?$/u.test(title));
}

// These decks deliberately use English on the front and Korean meanings on the back.
// Reject obvious theory cards rather than silently saving a different kind of exercise.
export function validVocabularyCards(cards:{question:string;answer:string}[]) {
  return cards.every(card=>card.question.length<=100&&/^[A-Za-z]+(?:[ '\u2019-][A-Za-z]+)*$/u.test(card.question.trim())&&/[가-힣]/u.test(card.answer));
}
