export const LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;
export type Level = (typeof LEVELS)[number];

export interface Topic {
  it: string;
  en: string;
}

// Each level leans on the grammar it should be practising:
// A1 present tense and basics, A2 past and near future, B1 experiences and opinions,
// B2 arguing and hypotheticals, C1 abstract ideas and nuance.
export const TOPICS: Record<Level, Topic[]> = {
  A1: [
    { it: "Presentati: come ti chiami, di dove sei e dove abiti.", en: "Introduce yourself: your name, where you're from, where you live." },
    { it: "Descrivi la tua famiglia.", en: "Describe your family." },
    { it: "Cosa mangi a colazione?", en: "What do you eat for breakfast?" },
    { it: "Descrivi la tua casa o la tua camera.", en: "Describe your home or your bedroom." },
    { it: "Cosa fai di solito durante la settimana?", en: "What do you usually do during the week?" },
    { it: "Quali sono i tuoi colori e i tuoi cibi preferiti?", en: "What are your favourite colours and foods?" },
    { it: "Descrivi la tua città.", en: "Describe your city." },
    { it: "Parla del tuo lavoro o dei tuoi studi.", en: "Talk about your job or your studies." },
    { it: "Che tempo fa oggi? Ti piace il clima del tuo paese?", en: "What's the weather like today? Do you like your country's climate?" },
    { it: "Come passi il fine settimana?", en: "How do you spend the weekend?" },
    { it: "Descrivi il tuo migliore amico o la tua migliore amica.", en: "Describe your best friend." },
    { it: "Sei in un bar: ordina qualcosa da bere e da mangiare.", en: "You're in a café: order something to drink and eat." },
  ],
  A2: [
    { it: "Racconta cosa hai fatto ieri.", en: "Tell me what you did yesterday." },
    { it: "Descrivi le tue ultime vacanze.", en: "Describe your last holiday." },
    { it: "Cosa hai mangiato ieri sera? Racconta la cena.", en: "What did you eat last night? Tell me about dinner." },
    { it: "Cosa farai il prossimo fine settimana?", en: "What will you do next weekend?" },
    { it: "Descrivi la tua routine del mattino.", en: "Describe your morning routine." },
    { it: "Racconta come hai conosciuto il tuo migliore amico.", en: "Tell the story of how you met your best friend." },
    { it: "Sei al ristorante: ordina e poi chiedi il conto.", en: "You're at a restaurant: order, then ask for the bill." },
    { it: "Racconta il tuo ultimo compleanno.", en: "Tell me about your last birthday." },
    { it: "Parla di un film o di una serie che hai visto di recente.", en: "Talk about a film or series you watched recently." },
    { it: "Spiega a un amico come arrivare a casa tua.", en: "Explain to a friend how to get to your home." },
    { it: "Racconta una giornata al mare o in montagna.", en: "Tell me about a day at the beach or in the mountains." },
    { it: "Parla di un regalo che hai ricevuto o che hai fatto.", en: "Talk about a gift you received or gave." },
  ],
  B1: [
    { it: "Racconta un viaggio che ti è rimasto nel cuore.", en: "Tell me about a trip that stayed with you." },
    { it: "Com'era la tua vita da bambino?", en: "What was your life like as a child?" },
    { it: "Cosa vorresti fare tra cinque anni?", en: "What would you like to be doing in five years?" },
    { it: "Racconta un problema che hai avuto in viaggio e come l'hai risolto.", en: "Describe a problem you had while travelling and how you solved it." },
    { it: "Parla di una tradizione del tuo paese.", en: "Talk about a tradition from your country." },
    { it: "Quali sono i vantaggi e gli svantaggi di vivere in città?", en: "What are the pros and cons of living in a city?" },
    { it: "Racconta un momento in cui hai imparato qualcosa di importante.", en: "Tell me about a moment when you learned something important." },
    { it: "Se vincessi alla lotteria, cosa faresti?", en: "If you won the lottery, what would you do?" },
    { it: "Descrivi il lavoro dei tuoi sogni.", en: "Describe your dream job." },
    { it: "Cosa pensi dei social network?", en: "What do you think about social media?" },
    { it: "Consiglia un libro, un film o un posto da visitare e spiega perché.", en: "Recommend a book, film or place to visit, and explain why." },
    { it: "Parla di un sogno o di un obiettivo che hai.", en: "Talk about a dream or a goal you have." },
  ],
  B2: [
    { it: "La tecnologia ci rende più liberi o più dipendenti? Argomenta la tua opinione.", en: "Does technology make us freer or more dependent? Argue your view." },
    { it: "Lavorare da casa: quali sono i pro e i contro?", en: "Working from home: what are the pros and cons?" },
    { it: "Quanto è importante conoscere più lingue?", en: "How important is it to know several languages?" },
    { it: "Racconta un cambiamento importante nella tua vita e cosa ti ha insegnato.", en: "Describe an important change in your life and what it taught you." },
    { it: "Se potessi cambiare una cosa nel tuo paese, quale sarebbe e perché?", en: "If you could change one thing about your country, what would it be and why?" },
    { it: "L'intelligenza artificiale è un'opportunità o una minaccia?", en: "Is artificial intelligence an opportunity or a threat?" },
    { it: "Racconta un malinteso culturale in cui ti sei trovato.", en: "Tell me about a cultural misunderstanding you were part of." },
    { it: "I giovani dovrebbero viaggiare prima di iniziare a lavorare?", en: "Should young people travel before they start working?" },
    { it: "Parla di un'abitudine che vorresti cambiare e di come lo faresti.", en: "Talk about a habit you'd like to change and how you'd do it." },
    { it: "Pensi che i social network influenzino la nostra felicità?", en: "Do you think social media affects our happiness?" },
    { it: "Descrivi una notizia recente che ti ha colpito e dai la tua opinione.", en: "Describe a recent news story that struck you and give your opinion." },
    { it: "Il turismo di massa fa più bene o più male alle città?", en: "Does mass tourism do more good or more harm to cities?" },
  ],
  C1: [
    { it: "«Il tempo è denaro»: sei d'accordo? Sviluppa il tuo punto di vista con degli esempi.", en: "“Time is money”: do you agree? Develop your view with examples." },
    { it: "Cosa significa per te avere successo nella vita?", en: "What does being successful in life mean to you?" },
    { it: "Qual è il ruolo dell'arte nella società contemporanea?", en: "What is the role of art in contemporary society?" },
    { it: "Discuti i vantaggi e i rischi della globalizzazione per le culture locali.", en: "Discuss the benefits and risks of globalisation for local cultures." },
    { it: "Se potessi tornare indietro nel tempo, cosa faresti in modo diverso?", en: "If you could go back in time, what would you do differently?" },
    { it: "Fino a che punto la privacy è un diritto da difendere nell'era digitale?", en: "How far is privacy a right worth defending in the digital age?" },
    { it: "Siamo ciò che ricordiamo? Rifletti sul rapporto tra memoria e identità.", en: "Are we what we remember? Reflect on memory and identity." },
    { it: "Spiega un proverbio, italiano o del tuo paese, e quando lo useresti.", en: "Explain a proverb, Italian or from your country, and when you would use it." },
    { it: "L'istruzione tradizionale è ancora adatta al mondo del lavoro di oggi?", en: "Is traditional education still suited to today's working world?" },
    { it: "Descrivi un luogo che ti ha cambiato e spiega perché.", en: "Describe a place that changed you and explain why." },
    { it: "Che rapporto c'è, secondo te, tra lingua e identità culturale?", en: "What do you think the relationship is between language and cultural identity?" },
    { it: "Presenta in due minuti un argomento che ti appassiona, come se parlassi a degli esperti.", en: "Present, in two minutes, a subject you are passionate about, as if speaking to experts." },
  ],
};

// A shuffled "bag" per level: you see every topic once before any repeats.
const bags: Partial<Record<Level, number[]>> = {};
let last: Topic | null = null;

function shuffled(n: number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function randomTopic(level: Level): Topic {
  const list = TOPICS[level];
  let bag = bags[level];
  if (!bag || !bag.length) {
    bag = shuffled(list.length);
    // never show the same topic twice in a row when the bag is refilled
    if (list.length > 1 && list[bag[bag.length - 1]] === last) {
      [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
    }
    bags[level] = bag;
  }
  last = list[bag.pop()!];
  return last;
}
