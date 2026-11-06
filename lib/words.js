// Built-in word bank used for the "🎲 random word" button and for auto-filling fleets.
// Kid-friendly, common English words grouped by length.
const WORDS = {
  2: ['GO', 'UP', 'ME', 'WE', 'ON', 'IN', 'AT', 'IT', 'NO', 'SO', 'TO', 'DO', 'HE', 'BE', 'MY', 'BY', 'OX', 'HI', 'AM', 'AN', 'AS', 'IF', 'IS', 'OF', 'OR', 'US'],
  3: ['CAT', 'DOG', 'SUN', 'MAP', 'HAT', 'BUS', 'CUP', 'FOX', 'PIG', 'BED', 'BOX', 'EGG', 'FAN', 'JAM', 'KEY', 'LOG', 'OWL', 'PEN', 'RUG', 'SKY', 'TOY', 'VAN', 'WEB', 'YAK', 'ZIP', 'ANT', 'BAT', 'COW', 'JAR', 'NET'],
  4: ['SHIP', 'FISH', 'BOAT', 'FROG', 'LAMP', 'MILK', 'NEST', 'PARK', 'RAIN', 'SAND', 'STAR', 'TREE', 'WAVE', 'WOLF', 'BIRD', 'CAKE', 'DUCK', 'GOLD', 'HILL', 'KITE', 'LION', 'MOON', 'ROAD', 'SEAL', 'SNOW', 'TENT', 'WIND', 'CRAB', 'DESK', 'DRUM'],
  5: ['OCEAN', 'WHALE', 'CLOUD', 'BEACH', 'TIGER', 'HORSE', 'APPLE', 'BREAD', 'CHAIR', 'PLANT', 'RIVER', 'STORM', 'TRAIN', 'ZEBRA', 'SHARK', 'PIANO', 'ROBOT', 'LEMON', 'MOUSE', 'HOUSE', 'CANDY', 'EAGLE', 'GRAPE', 'KOALA', 'MANGO', 'PANDA', 'SNAKE', 'TABLE', 'TRUCK', 'CORAL'],
  6: ['ANCHOR', 'ISLAND', 'PIRATE', 'CASTLE', 'JUNGLE', 'ROCKET', 'TURTLE', 'GARDEN', 'DRAGON', 'PENCIL', 'MONKEY', 'PLANET', 'WINDOW', 'BASKET', 'BUTTER', 'CARROT', 'DOCTOR', 'FOREST', 'GUITAR', 'HAMMER', 'KITTEN', 'LADDER', 'ORANGE', 'PARROT', 'RABBIT', 'SAILOR', 'SPIDER', 'TICKET', 'VALLEY', 'YELLOW'],
  7: ['DOLPHIN', 'CAPTAIN', 'OCTOPUS', 'PENGUIN', 'CHICKEN', 'KITCHEN', 'BLANKET', 'CAMPING', 'DIAMOND', 'FEATHER', 'GIRAFFE', 'HARBOUR', 'LANTERN', 'MACHINE', 'MONSTER', 'MORNING', 'PICTURE', 'PYRAMID', 'RAINBOW', 'SCIENCE', 'SEAWEED', 'THUNDER', 'TORNADO', 'VOLCANO', 'WEATHER', 'BICYCLE', 'CRYSTAL', 'CUSHION', 'JOURNEY', 'LIBRARY'],
  8: ['TREASURE', 'SANDWICH', 'ELEPHANT', 'KANGAROO', 'MOUNTAIN', 'DINOSAUR', 'BASEBALL', 'FOOTBALL', 'NOTEBOOK', 'HOSPITAL', 'AIRPLANE', 'BIRTHDAY', 'COMPUTER', 'EXERCISE', 'FLAMINGO', 'HEDGEHOG', 'HOMEWORK', 'MUSHROOM', 'PAINTING', 'SEASHELL', 'SKELETON', 'SQUIRREL', 'STARFISH', 'SUNLIGHT', 'UMBRELLA', 'VACATION', 'KEYBOARD', 'MARATHON', 'LAUGHTER', 'DAUGHTER'],
  9: ['SUBMARINE', 'BUTTERFLY', 'CHOCOLATE', 'JELLYFISH', 'WATERFALL', 'ADVENTURE', 'CROCODILE', 'ASTRONAUT', 'BLUEBERRY', 'DANGEROUS', 'EXPLORING', 'FIREWORKS', 'HAMBURGER', 'NEWSPAPER', 'PINEAPPLE', 'SCARECROW', 'SNOWFLAKE', 'TELEPHONE', 'TELESCOPE', 'VEGETABLE', 'WONDERFUL', 'LIGHTNING', 'NIGHTMARE', 'OPERATION', 'PROFESSOR'],
};

function randomWord(len, avoid = []) {
  const list = (WORDS[len] || []).filter(w => !avoid.includes(w));
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

module.exports = { WORDS, randomWord };
