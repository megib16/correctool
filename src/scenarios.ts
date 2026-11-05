import type { Level } from "./topics";

export interface Scenario {
  id: string;
  title: string; // Italian
  titleEn: string;
  goalIt: string; // shown to the learner
  goalEn: string;
  /** Instruction for the AI: who it is, the situation, how to open. Written in English. */
  setup: string;
}

const free = (level: Level): Scenario => ({
  id: `free-${level}`,
  title: "Chiacchierata libera",
  titleEn: "Free chat",
  goalIt: "Chiacchiera con una nuova amica italiana, di quello che vuoi.",
  goalEn: "Chat with a new Italian friend about anything you like.",
  setup:
    "You are Giulia, a friendly Italian woman chatting casually with the learner, whom you have just met. " +
    "Open with a warm greeting and a simple question, then follow the learner's interests naturally.",
});

// Maximum number of learner turns before the AI must wrap the conversation up.
export const MAX_TURNS: Record<Level, number> = { A1: 5, A2: 6, B1: 7, B2: 8, C1: 8 };

export const SCENARIOS: Record<Level, Scenario[]> = {
  A1: [
    {
      id: "cafe",
      title: "Al bar",
      titleEn: "At the café",
      goalIt: "Ordina un caffè e qualcosa da mangiare.",
      goalEn: "Order a coffee and something to eat.",
      setup:
        "You are a friendly barista in an Italian café and the learner is a customer. Greet them, take their order, " +
        "ask simple follow-ups (anything else? to drink here?), and tell them the price at the end.",
    },
    {
      id: "neighbour",
      title: "Un nuovo vicino",
      titleEn: "A new neighbour",
      goalIt: "Presentati al tuo nuovo vicino di casa.",
      goalEn: "Introduce yourself to your new neighbour.",
      setup:
        "You are Marco, a friendly neighbour meeting the learner, who has just moved into the building. " +
        "Greet them and ask basic questions: name, where they are from, job or studies, family.",
    },
    {
      id: "market",
      title: "Al mercato",
      titleEn: "At the market",
      goalIt: "Compra frutta e verdura.",
      goalEn: "Buy fruit and vegetables.",
      setup:
        "You are a cheerful fruit and vegetable seller at an Italian market and the learner is a customer. " +
        "Greet them, ask what they would like and how much, suggest something seasonal, and give the total price.",
    },
    free("A1"),
  ],
  A2: [
    {
      id: "restaurant",
      title: "Al ristorante",
      titleEn: "At the restaurant",
      goalIt: "Ordina una cena e chiedi il conto.",
      goalEn: "Order dinner and ask for the bill.",
      setup:
        "You are a waiter in an Italian restaurant and the learner is a guest. Seat them, take drinks, starters and mains " +
        "(mention a couple of dishes), answer simple questions about the menu, and bring the bill when asked.",
    },
    {
      id: "directions",
      title: "Chiedere indicazioni",
      titleEn: "Asking for directions",
      goalIt: "Sei perso: trova la stazione.",
      goalEn: "You're lost: find the train station.",
      setup:
        "You are a helpful passer-by in an Italian city. The learner is lost and wants to reach the train station. " +
        "Give directions step by step with simple expressions (a destra, a sinistra, dritto, vicino a), and check they understood.",
    },
    {
      id: "clothes",
      title: "In un negozio di abbigliamento",
      titleEn: "In a clothes shop",
      goalIt: "Compra una giacca: taglia, colore, prezzo.",
      goalEn: "Buy a jacket: size, colour, price.",
      setup:
        "You are a shop assistant in a clothes shop and the learner is a customer looking for a jacket. " +
        "Ask about size, colour and budget, suggest options, and handle the fitting-room and payment.",
    },
    free("A2"),
  ],
  B1: [
    {
      id: "hotel",
      title: "Un problema in albergo",
      titleEn: "A problem at the hotel",
      goalIt: "Fai il check-in e spiega un problema con la camera.",
      goalEn: "Check in and explain a problem with your room.",
      setup:
        "You are a hotel receptionist in Italy. The learner is checking in. After the check-in, the learner will have a problem " +
        "with the room (noise, heating, a broken item). Be polite, ask for details, and offer solutions such as changing room.",
    },
    {
      id: "doctor",
      title: "Dal medico",
      titleEn: "At the doctor's",
      goalIt: "Spiega i tuoi sintomi e chiedi consigli.",
      goalEn: "Describe your symptoms and ask for advice.",
      setup:
        "You are a family doctor in Italy and the learner is your patient. Ask what is wrong, for how long, " +
        "about other symptoms and habits, then give simple advice or a prescription.",
    },
    {
      id: "flat",
      title: "Cercare casa",
      titleEn: "Looking for a flat",
      goalIt: "Chiedi informazioni su un appartamento in affitto.",
      goalEn: "Ask about a flat for rent.",
      setup:
        "You are a letting agent showing an Italian flat over the phone to the learner. Answer questions about rent, " +
        "size, location and conditions, and ask what they are looking for. Invent plausible details.",
    },
    free("B1"),
  ],
  B2: [
    {
      id: "interview",
      title: "Un colloquio di lavoro",
      titleEn: "A job interview",
      goalIt: "Presentati e rispondi alle domande del selezionatore.",
      goalEn: "Introduce yourself and answer the interviewer's questions.",
      setup:
        "You are an HR interviewer at an Italian company hiring for a marketing role, interviewing the learner. " +
        "Ask about experience, strengths and weaknesses, motivation, and a situation where they solved a problem. Ask a follow-up challenge now and then.",
    },
    {
      id: "complaint",
      title: "Un reclamo",
      titleEn: "A complaint",
      goalIt: "Restituisci un prodotto difettoso e chiedi un rimborso.",
      goalEn: "Return a faulty product and ask for a refund.",
      setup:
        "You are a customer-service agent in an Italian electronics shop. The learner wants to return a faulty product. " +
        "Be polite but at first reluctant (shop policy, missing receipt); eventually offer an exchange, a voucher or a refund if they argue well.",
    },
    {
      id: "flatmate",
      title: "Discussione con il coinquilino",
      titleEn: "A talk with your flatmate",
      goalIt: "Risolvi un problema di convivenza.",
      goalEn: "Sort out a problem of living together.",
      setup:
        "You are the learner's flatmate, a bit messy and slightly defensive. The learner wants to talk about a problem in the flat " +
        "(noise, chores, bills). Explain your side and look for a compromise.",
    },
    free("B2"),
  ],
  C1: [
    {
      id: "debate",
      title: "Un dibattito",
      titleEn: "A debate",
      goalIt: "Difendi la tua opinione su un tema d'attualità.",
      goalEn: "Defend your opinion on a current issue.",
      setup:
        "You are a thoughtful debate partner. Pick a current issue (remote work, AI in schools, mass tourism), state it, and take a respectful stance " +
        "opposite to whatever the learner argues. Challenge their points with counter-examples. Use an advanced, idiomatic register.",
    },
    {
      id: "negotiation",
      title: "Trattare lo stipendio",
      titleEn: "Negotiating a contract",
      goalIt: "Negozia le condizioni del tuo nuovo contratto.",
      goalEn: "Negotiate the terms of your new contract.",
      setup:
        "You are the HR manager of an Italian firm offering the learner a job. Your budget is limited. Negotiate salary, remote work and bonuses, " +
        "make counter-offers, and push back politely until a deal is reached or clearly not possible.",
    },
    {
      id: "radio",
      title: "Un'intervista radiofonica",
      titleEn: "A radio interview",
      goalIt: "Parla della tua passione a un giornalista.",
      goalEn: "Talk about your passion to a journalist.",
      setup:
        "You are a radio journalist interviewing the learner about something they are passionate about. Start by asking what it is, " +
        "then ask probing, nuanced follow-up questions about their motivation, challenges and views.",
    },
    free("C1"),
  ],
};
