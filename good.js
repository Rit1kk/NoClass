// Words blocked in reports and lost & found notes. Lowercase, one word per entry.
// Repeated letters are collapsed automatically, so "chuutiyaa" matches "chutiya".
export const BAD_WORDS = [
    // Hinglish: strong
    "chutiya", "chutiye", "chutiyapa", "chutiyapanti", "chut", "chutad", "chutmarike", "chutmarani",
    "madarchod", "maderchod", "madrchod", "madharchod", "madarchodd", "mderchod",
    "behenchod", "bhenchod", "behnchod", "bhnchod", "behanchod", "bhenchodd",
    "bhosdike", "bhosdika", "bhosdi", "bhosda", "bhosadi", "bhosadike", "bhosdiwale", "bhosadchod",
    "gandu", "gaandu", "gand", "gaand", "gandmara", "gaandmara", "gandmasti",
    "lund", "lauda", "laude", "lavda", "lavde", "loda", "lode", "lodu", "lawda", "lawde",
    "randi", "raand", "randwa", "randibaaz",
    "harami", "haramkhor", "haramzada", "haramzade", "haraamzaade", "haramzadi",
    "kamina", "kamine", "kamini", "kaminey",
    "kutta", "kutte", "kutiya", "kuttiya", "kutti",
    "jhatu", "jhant", "jhaatu", "jhaant",
    "chodu", "chodna", "chudai", "chudail", "chudap",
    "suar", "soor", "sooar",
    "hijra", "hijda", "chakka",
    // caste / communal slurs (a college board needs these blocked)
    "chamar", "bhangi", "katua", "katwa", "chinki",
    // abbreviations
    "bsdk", "bkl", "mkc", "bhk", "mkb", "rndi", 
    // English
    "fuck", "fucker", "fucking", "fuk", "fck", "fuc", "motherfucker", "mofo",
    "shit", "bullshit", "bitch", "bastard", "asshole", "dick", "cock", "pussy", "slut", "whore", "cunt", "wanker"
  ];
  
  // Mild words: off by default, because they are common in normal talk. Turn on in app.js if you want.
  export const MILD_WORDS = [
    "saala", "saale", "sala", "sale", "bakchod", "bakchodi", "bakwas", "bewakoof", "bewakuf", "nalayak",
    "nikamma", "gadha", "ullu", "pagal", "chod", "chodo", "tatti", "dalla", "dalal", "ghatiya"
  ];
  
  // Hindi in Devanagari (add spelling variants as you notice them)
  export const BAD_DEVANAGARI = [
    "चूतिया", "चुतिया", "मादरचोद", "मादर", "बहनचोद", "भोसड़ीके", "भोसड़ी", "गांडू", "गांड",
    "लंड", "लौड़ा", "रंडी", "हरामी", "हरामखोर", "हरामजादा", "कमीना", "कुत्ता", "कुत्ते", "झाटू"
  ];