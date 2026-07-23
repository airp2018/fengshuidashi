# ☯ FengShuiMaster

[简体中文](README.md) | [English](README_EN.md)

> **Photograph your space and discover how its furniture and orientation could be adjusted.**

[Try it online](https://fengshuidashi.onrender.com/) · Take photos directly from your mobile browser

FengShuiMaster is a mobile-first spatial feng shui analysis tool. Photograph a bedroom, living room, office, or shop, and the AI identifies the spatial relationships among doors, windows, furniture, and other key objects. It then combines compass orientation with a purpose-built feng shui encyclopedia to offer specific suggestions for room layout and object placement.

## What Makes It Different?

### 📱 Pick up your phone and take a photo

There is no need to draw a floor plan or study concepts such as the Eight Trigrams or Five Elements beforehand. Open the website, take a photo of the space—or choose one from your gallery—and begin the analysis.

### 👁️ Understand the space before discussing feng shui

The AI first examines doors, windows, beds, sofas, desks, mirrors, stoves, checkout counters, and other visible elements, along with the spatial relationships between them. The analysis is grounded in the actual scene instead of offering only generic feng shui answers.

### 📚 A dedicated feng shui encyclopedia

The project includes a feng shui knowledge base organized by scene, orientation, and object. It covers directions and the Five Elements, entrances and foyers, living and dining rooms, bedrooms and studies, kitchens and bathrooms, offices, shops, and more. Visual findings are matched with relevant encyclopedia entries to provide more specific context for each explanation.

### 🧭 Orientation is part of the analysis

When supported, the app can read your phone's direction sensor. Otherwise, you can calibrate the compass manually by dragging it. Combining the photographed layout with its real-world orientation helps make the suggestions more relevant to the space.

### 🪑 Practical placement suggestions

The report goes beyond simply listing favorable and unfavorable features. It aims to explain:

- Which areas deserve attention;
- How doors, windows, and major pieces of furniture relate to one another;
- How beds, sofas, desks, mirrors, stoves, and other objects could be adjusted;
- Which issues may be improved through changes in orientation, distance, screening, color, or storage.

## How to Use It

1. Open the [online app](https://fengshuidashi.onrender.com/) on your phone.
2. Photograph the current space, or choose an image from your gallery.
3. Confirm the scene type and calibrate the compass direction if necessary.
4. Answer the follow-up questions generated from the photo, or skip them and start the analysis immediately.
5. Review the spatial feng shui report, then copy its suggestions for reference or sharing.

For better recognition, try to include the doors, windows, main furniture, and overall spatial relationships in the same photo. Avoid images that are too dark, heavily tilted, or limited to a single object.

## Supported Spaces

| Space | Main areas of focus |
| --- | --- |
| 🛏️ Bedroom | Headboard, mirrors, doors and windows, wardrobe, color, and the sleeping area |
| 🛋️ Living room | Sofa, TV wall, circulation, lighting, wealth position, and decorative objects |
| 🍳 Kitchen | Stove, sink, refrigerator, entrance, and the relationship between water and fire |
| 📚 Study | Desk orientation, support behind the seat, doors and windows, and the Wenchang position |
| 💼 Office | Desk, seating, entrance, lighting, and workflow |
| 🏪 Shop | Storefront, checkout counter, customer flow, displays, and interior layout |
| 🍽️ Dining room | Dining-table shape and placement, relationship to the kitchen, lighting, and circulation |
| 🚿 Bathroom | Entrance, toilet, wet and dry areas, ventilation, and adjacent spaces |

## What's in the Feng Shui Encyclopedia?

The encyclopedia starts with the type of space and can be explored further by orientation and object. Its main topics include:

- The eight directions, Eight Trigrams, Five Elements, and common spatial relationships;
- Main doors, foyers, facing doors, shoe cabinets, and screens;
- Living rooms, dining rooms, sofas, TV walls, fish tanks, and wealth positions;
- Primary bedrooms, children's rooms, senior bedrooms, beds, mirrors, wardrobes, and desks;
- Kitchens, stoves, sinks, refrigerators, bathrooms, balconies, and courtyards;
- Desks, executive offices, meeting rooms, storefronts, checkout counters, and displays;
- Common layout issues, color references, and practical adjustment methods.

## Running the Open-Source Project

The project is built with Node.js, Express, a vision-model API, and a local feng shui encyclopedia, and it can be deployed with Docker. After configuring the required environment variables, run:

```bash
npm install
npm start
```

The live version is automatically deployed through Render whenever the GitHub `main` branch is updated.

## Disclaimer

This project offers spatial-layout and interior-placement references from the perspective of traditional Chinese feng shui culture. It does not constitute architectural, renovation, fire-safety, medical, investment, or other professional advice, nor does it guarantee any real-world outcome. Consult the appropriate qualified professionals before making changes involving structural elements, electrical systems, gas lines, or load-bearing walls.
