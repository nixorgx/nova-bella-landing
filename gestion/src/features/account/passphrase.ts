import { randomInt } from "node:crypto";

/** Common Spanish words, no accents or eñes (easy to type on any keyboard), 3 to 10 letters. */
export const PASSPHRASE_WORDS: readonly string[] = [
  "Nube", "Lago", "Rio", "Monte", "Campo", "Flor", "Brisa", "Estrella", "Playa", "Arena", "Piedra", "Bosque", "Valle",
  "Isla", "Mar", "Ola", "Viento", "Lluvia", "Trigo", "Maiz", "Miel", "Azucar", "Canela", "Vainilla", "Limon", "Naranja",
  "Manzana", "Pera", "Uva", "Fresa", "Cereza", "Durazno", "Mango", "Coco", "Menta", "Laurel", "Romero", "Tomillo", "Jazmin",
  "Lirio", "Violeta", "Dalia", "Azalea", "Camelia", "Orquidea", "Tulipan", "Margarita", "Girasol", "Helecho", "Roble",
  "Pino", "Cedro", "Sauce", "Olivo", "Nogal", "Cielo", "Aurora", "Alba", "Tarde", "Noche", "Verano", "Otono", "Invierno",
  "Abril", "Mayo", "Junio", "Perla", "Coral", "Jade", "Ambar", "Rubi", "Topacio", "Zafiro", "Plata", "Oro", "Cobre",
  "Seda", "Lino", "Lana", "Encaje", "Terciopelo", "Botones", "Hilo", "Aguja", "Cinta", "Bufanda", "Sombrero", "Guante",
  "Bolso", "Collar", "Pulsera", "Anillo", "Espejo", "Vela", "Farol", "Puerta", "Ventana", "Balcon", "Patio", "Fuente",
  "Puente", "Camino", "Sendero", "Plaza", "Torre", "Casa", "Cocina", "Mesa", "Silla", "Libro", "Cuento", "Poema",
  "Cancion", "Danza", "Pintura", "Tinta", "Papel", "Pluma", "Reloj", "Brujula", "Mapa", "Viaje", "Barco", "Faro",
  "Puerto", "Delfin", "Gaviota", "Colibri", "Gorrion", "Paloma", "Cisne", "Tortuga", "Conejo", "Ciervo", "Zorro", "Gato",
  "Panda", "Koala", "Abeja", "Grillo", "Cuarzo", "Marfil", "Cacao", "Almendra", "Nuez", "Avena", "Pan", "Queso", "Dulce",
  "Helado", "Pastel", "Galleta", "Chocolate", "Taza", "Sonrisa", "Abrazo", "Suerte", "Alegria", "Calma", "Paz", "Fiesta",
  "Risa", "Amistad", "Sueno", "Magia",
].filter((word, index, all) => /^[A-Za-z]{3,10}$/.test(word) && all.indexOf(word) === index);

const WORD_COUNT = 4;

/**
 * A readable temporary password such as "Lirio-Faro-Nogal-Brisa-47": four random real words and a
 * two-digit number joined by hyphens (always well over the 12-character minimum). Drawn with the
 * operating system's CSPRNG; only ever created on the server.
 */
export function generatePassphrase(pick: (max: number) => number = (max) => randomInt(max)): string {
  const words = Array.from({ length: WORD_COUNT }, () => PASSPHRASE_WORDS[pick(PASSPHRASE_WORDS.length)]);
  const number = String(pick(90) + 10);
  return `${words.join("-")}-${number}`;
}
