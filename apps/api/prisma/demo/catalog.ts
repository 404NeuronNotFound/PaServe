export type Kind =
  | 'coffee'
  | 'tea'
  | 'milk-tea'
  | 'pastry'
  | 'meal'
  | 'dessert'
  | 'sandwich'
  | 'juice';
export type MenuCategory = { name: string; kind: Kind; products: string };
export const businesses = [
  {
    name: 'Sinag at Butil',
    slug: 'demo-sinag-at-butil',
    concept: 'Philippine specialty coffee and small-batch pastries',
    color: '#694232',
    accent: '#DAB867',
    tables: 12,
    daily: 50,
    dineIn: 0.55,
    peaks: [8, 9, 12, 15, 16],
    menu: [
      [
        'Espresso Bar',
        'coffee',
        'Americano:110|Cappuccino:145|Cafe Latte:150|Spanish Latte:165|Mocha:170',
      ],
      [
        'Iced Coffee',
        'coffee',
        'Iced Americano:120|Iced Spanish Latte:175|Iced Caramel Macchiato:185|Cold Brew:160|Iced Hazelnut Latte:180',
      ],
      [
        'Local Coffee',
        'coffee',
        'Benguet Pour Over:190|Bukidnon Pour Over:185|Sagada Pour Over:200|Barako Brew:130|Coconut Latte:180',
      ],
      [
        'Non Coffee',
        'tea',
        'Matcha Latte:175|Chai Latte:165|Hot Chocolate:150|Hojicha Latte:180|Iced Matcha Latte:185',
      ],
      [
        'Tea Leaves',
        'tea',
        'Jasmine Tea:110|Earl Grey Tea:120|Chamomile Tea:120|Peppermint Tea:110|Hibiscus Tea:120',
      ],
      [
        'Pastry Counter',
        'pastry',
        'Butter Croissant:100|Chocolate Danish:120|Cinnamon Roll:110|Almond Croissant:145|Cheese Ensaymada:95',
      ],
      [
        'Sandwiches',
        'sandwich',
        'Chicken Sandwich:195|Tuna Melt:190|Ham and Cheese Toastie:180|Egg Salad Sandwich:165|Mushroom Cheese Toastie:185',
      ],
      [
        'Sweet Endings',
        'dessert',
        'Basque Cheesecake:185|Chocolate Brownie:95|Chocolate Chip Cookie:75|Carrot Cake:160|Calamansi Tart:140',
      ],
    ],
  },
  {
    name: 'Umaga sa Dahon',
    slug: 'demo-umaga-sa-dahon',
    concept: 'Garden brunch cafe with generous breakfast plates',
    color: '#45634C',
    accent: '#E6BA70',
    tables: 16,
    daily: 75,
    dineIn: 0.7,
    peaks: [9, 10, 11, 12, 14],
    menu: [
      [
        'Breakfast Plates',
        'meal',
        'Beef Tapa Silog:285|Chicken Tocino Silog:255|Longganisa Silog:265|Bangus Silog:295|Mushroom Silog:245',
      ],
      [
        'Brunch Favorites',
        'meal',
        'Eggs Benedict:310|Avocado Egg Toast:275|Smoked Salmon Toast:345|Bacon Breakfast Bowl:290|Shakshuka:280',
      ],
      [
        'Pancakes and Waffles',
        'dessert',
        'Buttermilk Pancakes:220|Banana Pancakes:240|Ube Pancakes:255|Chicken Waffles:325|Mango Waffles:265',
      ],
      [
        'Sandwich Board',
        'sandwich',
        'Clubhouse Sandwich:285|Grilled Chicken Panini:265|Bacon Egg Sandwich:245|Classic Burger:295|Mushroom Burger:275',
      ],
      [
        'Pasta Lunch',
        'meal',
        'Chicken Alfredo:315|Bacon Carbonara:295|Tomato Basil Pasta:265|Shrimp Aglio Olio:335|Mushroom Pesto Pasta:285',
      ],
      [
        'Coffee Break',
        'coffee',
        'Cafe Latte:155|Spanish Latte:175|Iced Americano:130|Cappuccino:155|Iced Mocha:185',
      ],
      [
        'Fresh Press',
        'juice',
        'Fresh Calamansi Juice:120|Mango Smoothie:175|Watermelon Juice:150|Pineapple Juice:140|Cucumber Lemonade:145',
      ],
      [
        'Cake Cabinet',
        'dessert',
        'Basque Cheesecake:195|Banana Bread:110|Mango Crepe Cake:210|Chocolate Cake:190|Lemon Loaf:120',
      ],
    ],
  },
  {
    name: 'Hapag ng Hiraya',
    slug: 'demo-hapag-ng-hiraya',
    concept: 'Casual Filipino restaurant for shared family meals',
    color: '#963E30',
    accent: '#D8AF5C',
    tables: 20,
    daily: 65,
    dineIn: 0.75,
    peaks: [11, 12, 13, 17, 18, 19, 20],
    menu: [
      [
        'Pampagana',
        'meal',
        'Lumpiang Shanghai:195|Tokwat Baboy:210|Crispy Kangkong:165|Calamares:245|Cheese Sticks:155',
      ],
      [
        'Rice Meals',
        'meal',
        'Chicken Adobo Rice:245|Pork Adobo Rice:255|Beef Tapa Rice:275|Pork Sisig Rice:265|Grilled Liempo Rice:285',
      ],
      [
        'Chicken Kitchen',
        'meal',
        'Chicken Inasal:275|Crispy Fried Chicken:285|Chicken Tinola:295|Chicken Curry:290|Chicken Afritada:285',
      ],
      [
        'Family Classics',
        'meal',
        'Beef Kare Kare:425|Pork Sinigang:365|Beef Caldereta:395|Pork Binagoongan:335|Bicol Express:345',
      ],
      [
        'Seafood',
        'meal',
        'Grilled Bangus:345|Garlic Butter Shrimp:395|Sweet Sour Fish:355|Sinigang na Hipon:385|Crispy Tilapia:315',
      ],
      [
        'Gulay',
        'meal',
        'Pinakbet:225|Laing:235|Chopsuey:245|Ginisang Monggo:195|Tortang Talong:185',
      ],
      [
        'Panghimagas',
        'dessert',
        'Halo Halo:175|Leche Flan:125|Buko Pandan:135|Turon:105|Ube Ice Cream:115',
      ],
      [
        'Palamig',
        'juice',
        'Sago Gulaman:95|Fresh Calamansi Juice:110|Mango Shake:155|Buko Juice:120|Iced Lemongrass Tea:100',
      ],
    ],
  },
  {
    name: 'Masa at Mithi',
    slug: 'demo-masa-at-mithi',
    concept: 'Neighborhood bakery cafe with Filipino breads',
    color: '#99622E',
    accent: '#EAC995',
    tables: 12,
    daily: 45,
    dineIn: 0.5,
    peaks: [7, 8, 9, 15, 16],
    menu: [
      [
        'Fresh Breads',
        'pastry',
        'Classic Pandesal:30|Cheese Pandesal:45|Ube Pandesal:50|Spanish Bread:40|Pan de Coco:40',
      ],
      [
        'Viennoiserie',
        'pastry',
        'Butter Croissant:105|Almond Croissant:145|Ham Cheese Croissant:165|Pain au Chocolat:130|Chocolate Danish:125',
      ],
      [
        'Sweet Buns',
        'pastry',
        'Cinnamon Roll:115|Cheese Ensaymada:95|Ube Ensaymada:110|Coffee Bun:85|Raisin Bun:75',
      ],
      [
        'Savory Oven',
        'pastry',
        'Chicken Empanada:95|Beef Empanada:105|Spinach Quiche:160|Bacon Quiche:175|Sausage Roll:110',
      ],
      [
        'Sandwich Lunch',
        'sandwich',
        'Chicken Sandwich:195|Tuna Melt:190|Ham Cheese Baguette:210|Egg Salad Sandwich:165|Roast Beef Sandwich:245',
      ],
      [
        'Coffee Pairings',
        'coffee',
        'Americano:115|Cafe Latte:150|Cappuccino:150|Spanish Latte:170|Iced Mocha:180',
      ],
      [
        'Tea and Chocolate',
        'tea',
        'Hot Chocolate:145|Matcha Latte:175|Chai Latte:160|Earl Grey Tea:115|Chamomile Tea:115',
      ],
      [
        'Cake Slices',
        'dessert',
        'Basque Cheesecake:185|Chocolate Cake:175|Carrot Cake:165|Banana Bread:95|Calamansi Tart:135',
      ],
    ],
  },
  {
    name: 'Sipa at Sago',
    slug: 'demo-sipa-at-sago',
    concept: 'Lively milk tea counter with fruit teas and snacks',
    color: '#634775',
    accent: '#DCA7B5',
    tables: 10,
    daily: 100,
    dineIn: 0.3,
    peaks: [11, 13, 14, 15, 16, 17, 18],
    menu: [
      [
        'Classic Milk Tea',
        'milk-tea',
        'Classic Pearl Milk Tea:110|Wintermelon Milk Tea:120|Okinawa Milk Tea:130|Hokkaido Milk Tea:135|Assam Milk Tea:115',
      ],
      [
        'Brown Sugar',
        'milk-tea',
        'Brown Sugar Pearl Milk:145|Brown Sugar Milk Tea:140|Brown Sugar Matcha:155|Brown Sugar Cocoa:150|Brown Sugar Coffee:155',
      ],
      [
        'Cream Cheese Series',
        'milk-tea',
        'Cream Cheese Matcha:165|Cream Cheese Wintermelon:150|Cream Cheese Cocoa:155|Cream Cheese Oolong:150|Cream Cheese Taro:160',
      ],
      [
        'Fruit Tea',
        'juice',
        'Passionfruit Tea:130|Peach Tea:135|Lychee Tea:135|Mango Tea:140|Strawberry Tea:140',
      ],
      [
        'Specialty Milk',
        'milk-tea',
        'Taro Milk Tea:140|Ube Milk Tea:145|Thai Milk Tea:140|Honeydew Milk Tea:135|Matcha Milk Tea:150',
      ],
      [
        'Coffee Cooler',
        'coffee',
        'Iced Americano:110|Iced Spanish Latte:150|Iced Caramel Macchiato:160|Cold Brew:140|Iced Mocha:155',
      ],
      [
        'Snack Break',
        'meal',
        'Chicken Popcorn:145|Cheese Fries:110|Potato Wedges:115|Chicken Nuggets:125|Onion Rings:115',
      ],
      [
        'Sweet Bites',
        'dessert',
        'Chocolate Brownie:85|Chocolate Chip Cookie:65|Mochi:95|Mini Waffles:110|Ube Cake:135',
      ],
    ],
  },
] as const;

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
