"use client";

import {
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type Language = "es" | "en";

const LANGUAGE_KEY = "turesma-language";

const translations: Record<string, string> = {
  "Nosotros": "About us",
  "Flota": "Fleet",
  "Destinos": "Destinations",
  "Servicios": "Services",
  "Soluciones": "Solutions",
  "Contacto": "Contact",
  "Ingresar": "Log in",
  "Registrarse": "Sign up",
  "Abrir menú": "Open menu",
  "Cerrar menú": "Close menu",
  "Idioma": "Language",
  "Contactar Asesor": "Contact an advisor",
  "Navegación móvil": "Mobile navigation",
  "VIAJA CON": "TRAVEL WITH",
  "EXCELENCIA.": "EXCELLENCE.",
  "Soluciones de transporte de alta gama en Manta. Puntualidad, confort y seguridad en cada kilómetro del Ecuador.": "Premium transportation services in Manta. Punctuality, comfort, and safety on every kilometer of your journey across Ecuador.",
  "Ver Flota": "View our fleet",
  "Contactar asesor": "Contact an advisor",
  "SOBRE NOSOTROS": "ABOUT US",
  "En TURESMA S.A. redefinimos el transporte turístico con un compromiso inquebrantable con la seguridad y la elegancia. Desde Manta, servimos a todo el Ecuador.": "At TURESMA S.A., we redefine tourism transportation with an unwavering commitment to safety and comfort. Based in Manta, we serve destinations throughout Ecuador.",
  "TURISMO VIP": "VIP TRAVEL",
  "SEGURIDAD 24/7": "24/7 SAFETY",
  "PUNTUALIDAD": "PUNCTUALITY",
  "LOGÍSTICA": "LOGISTICS",
  "NUESTRA ESENCIA": "OUR ESSENCE",
  "El compromiso que guía cada traslado y cada decisión de TURESMA.": "The commitment that guides every trip and every decision at TURESMA.",
  "MISIÓN": "OUR MISSION",
  "Brindar servicios de transporte turístico, ejecutivo y logístico seguros, cómodos y confiables, apoyados en un equipo responsable, tecnología y altos estándares de calidad. Trabajamos para ofrecer traslados eficientes y una experiencia satisfactoria a nuestros clientes, tanto a nivel local como nacional.": "To provide safe, comfortable, and reliable tourism, executive, and logistics transportation, supported by a responsible team, technology, and high quality standards. We deliver efficient trips and a satisfying experience to our clients, locally and nationwide.",
  "VISIÓN": "OUR VISION",
  "Ser una empresa referente a nivel nacional en transporte turístico, ejecutivo y logístico, reconocida por la excelencia de nuestro servicio, la innovación, la seguridad y el compromiso permanente con nuestros clientes.": "To become a leading nationwide tourism, executive, and logistics transportation company, recognized for service excellence, innovation, safety, and our lasting commitment to clients.",
  "SEGURIDAD, CONFIANZA Y EXCELENCIA EN CADA CAMINO.": "SAFETY, TRUST, AND EXCELLENCE ON EVERY JOURNEY.",
  "NUESTRA FLOTA": "OUR FLEET",
  "Unidades disponibles para su servicio": "Vehicles ready to serve you",
  "Transporte": "Transportation",
  "Pasajeros": "Passengers",
  "Desliza": "Swipe",
  "Anterior": "Previous",
  "Siguiente": "Next",
  "Reservar un vehículo": "Request a vehicle",
  "Nuestros Viajes": "Our Journeys",
  "Momentos reales de nuestros recorridos por Manabí y todo el Ecuador": "Real moments from our trips across Manabí and Ecuador",
  "Viaje realizado por Turesma": "Trip by Turesma",
  "Desde Manta hacia Ecuador": "From Manta across Ecuador",
  "Destinos para tu próximo viaje": "Destinations for your next trip",
  "Algunos lugares emblemáticos que puedes considerar para tu próximo traslado.": "A few iconic places to consider for your next trip.",
  "Costa manabita y entorno del Parque Nacional Machalilla.": "The Manabí coast and the surroundings of Machalilla National Park.",
  "Ciudad Alfaro, historia y tradición artesanal manabita.": "Ciudad Alfaro, history, and Manabí's artisan traditions.",
  "Malecón y paisajes del estuario del río Chone.": "The waterfront and scenery around the Chone River estuary.",
  "Recorrido urbano junto al río Guayas y el Malecón.": "City sights along the Guayas River and the Malecón waterfront.",
  "Centro histórico, arquitectura y paisajes de la capital.": "Historic center, architecture, and views of the capital.",
  "Cascadas y paisajes andinos, como el Pailón del Diablo.": "Waterfalls and Andean scenery, including Pailón del Diablo.",
  "Bosque nublado y naturaleza del Chocó Andino.": "Cloud forest and nature in the Chocó Andino.",
  "Centro histórico y vista panorámica desde Turi.": "Historic center and panoramic views from Turi.",
  "Panorámica de la playa y el puerto pesquero de Puerto López": "Panoramic view of Puerto López beach and fishing harbor",
  "Plaza central de Montecristi y mural de Eloy Alfaro": "Montecristi's central plaza and Eloy Alfaro mural",
  "Malecón de Bahía de Caráquez": "Bahía de Caráquez waterfront",
  "Vista aérea de Guayaquil al atardecer": "Aerial view of Guayaquil at sunset",
  "Calle del centro histórico de Quito de noche, con una iglesia al fondo": "A street in Quito's historic center at night, with a church in the background",
  "Cascada Pailón del Diablo en Baños de Agua Santa": "Pailón del Diablo waterfall in Baños de Agua Santa",
  "Vista del bosque nublado y el valle de Mindo": "View of Mindo's cloud forest and valley",
  "Vista panorámica de Cuenca desde Turi": "Panoramic view of Cuenca from Turi",
  "Foto:": "Photo:",
  "Dominio público": "Public domain",
  "TURESMA en movimiento": "TURESMA in motion",
  "Conoce nuestros vehículos, servicios y experiencias en carretera.": "Discover our vehicles, services, and experiences on the road.",
  "Próximamente en movimiento": "Coming soon",
  "Aquí podrás descubrir los videos de nuestros recorridos, vehículos y servicios.": "Here you will discover videos of our trips, vehicles, and services.",
  "Servicios Premium": "Premium Services",
  "Traslados Ejecutivos": "Executive Transfers",
  "Puntualidad absoluta para viajes de negocios, traslados al aeropuerto y logística corporativa.": "On-time service for business travel, airport transfers, and corporate logistics.",
  "Tours Turísticos": "Sightseeing Tours",
  "Guías certificados y rutas personalizadas por la costa manabita y todo el Ecuador.": "Certified guides and custom routes along the Manabí coast and throughout Ecuador.",
  "Logística de Eventos": "Event Transportation",
  "Coordinación de transporte para congresos, bodas y eventos institucionales masivos.": "Transportation coordination for conferences, weddings, and large institutional events.",
  "Más que una flota": "More than a fleet",
  "Cuéntanos qué necesitas.": "Tell us what you need.",
  "Diseñamos la solución de transporte de acuerdo con tu ruta, tus tiempos y el tamaño de tu operación.": "We tailor transportation to your route, schedule, and group size.",
  "Traslado individual": "Private transfer",
  "Un viaje cómodo y puntual para una persona o familia.": "A comfortable, on-time trip for an individual or family.",
  "Gira turística": "Sightseeing trip",
  "Itinerarios personalizados para descubrir Ecuador.": "Custom itineraries to discover Ecuador.",
  "Transporte empresarial": "Corporate transportation",
  "Movilización coordinada para equipos y colaboradores.": "Coordinated transportation for teams and employees.",
  "Varios vehículos, horarios y puntos bajo una sola coordinación.": "Multiple vehicles, schedules, and stops coordinated in one plan.",
  "Requerimiento especial": "Special request",
  "Cuéntanos el desafío y buscamos la alternativa adecuada.": "Tell us what you have in mind and we will find the right option.",
  "Tú defines el requerimiento. Nosotros lo coordinamos.": "You define the requirements. We coordinate the journey.",
  "Adaptamos vehículo, horarios, ruta y operación para ofrecerte una propuesta clara, segura y conveniente.": "We tailor the vehicle, schedule, route, and service to provide a clear, safe, and convenient proposal.",
  "Cotizar en línea": "Get a quote online",
  "Cuéntanos tu requerimiento": "Tell us what you need",
  "Cada viaje es una oportunidad para llegar más lejos, no solo en distancia, sino en confianza": "Every journey is an opportunity to go farther—not only in distance, but in trust.",
  "Impulsamos caminos, conectamos sueños.": "We open roads and connect dreams.",
  "GERENCIA, TURESMA MANTA": "TURESMA MANTA MANAGEMENT",
  "VIAJA SEGURO,": "TRAVEL SAFELY,",
  "VIAJA CON TURESMA.": "TRAVEL WITH TURESMA.",
  "Líderes en transporte turístico en Manta. Calidad garantizada para cada pasajero.": "Manta's trusted tourism transportation provider. Quality service for every passenger.",
  "UBICACIÓN": "LOCATION",
  "Manta, Manabí, Ecuador": "Manta, Manabí, Ecuador",
  "EMAIL OFICIAL": "OFFICIAL EMAIL",
  "¿POR QUÉ ELEGIRNOS?": "WHY CHOOSE US?",
  "RASTREO SATELITAL GPS": "GPS TRACKING",
  "Seguridad total en tiempo real para todas nuestras unidades.": "Real-time visibility and safety for our vehicles.",
  "SEGUROS DE PASAJEROS": "PASSENGER INSURANCE",
  "Cobertura completa y cumplimiento de toda la normativa legal.": "Comprehensive coverage and compliance with applicable regulations.",
  "ATENCIÓN 24 HORAS": "24-HOUR SUPPORT",
  "Soporte y coordinación logística los 365 días del año.": "Support and logistics coordination, 365 days a year.",
  "Conocer más servicios": "Explore our services",
  "Preguntas Frecuentes": "Frequently Asked Questions",
  "Resolvemos las dudas más comunes para que reserves con más rapidez y confianza.": "Answers to common questions so you can book with confidence.",
  "¿Cómo hago una reserva?": "How do I book?",
  "Puedes reservar por medio de nuestro sistema web o  WhatsApp o con un asesor. Solo necesitamos fecha, hora, origen, destino y cantidad de pasajeros para confirmar tu unidad.": "You can book through our website, WhatsApp, or an advisor. We need your date, time, pickup, destination, and passenger count to coordinate your trip.",
  "¿Atienden viajes dentro y fuera de Manta?": "Do you serve areas inside and outside Manta?",
  "Sí. Operamos en Manta y realizamos traslados a nivel provincial y nacional, según disponibilidad y planificación de ruta.": "Yes. We operate in Manta and provide trips throughout the province and country, subject to availability and route planning.",
  "¿Cómo elijo el vehículo adecuado para mi viaje?": "How do I choose the right vehicle for my trip?",
  "La mejor opción depende del número de pasajeros, el equipaje y el tipo de recorrido. Al cotizar, cuéntanos esos detalles y te ayudaremos a elegir el vehículo adecuado.": "The best option depends on the number of passengers, luggage, and type of trip. When requesting a quote, share those details and we will help you choose the right vehicle.",
  "Cotizar traslado": "Request a transfer quote",
  "¿Puedo pedir una cotización antes de reservar?": "Can I request a quote before booking?",
  "Claro. Te enviamos una cotización previa sin compromiso para que conozcas tarifas, condiciones y tiempos estimados.": "Of course. We can provide a no-obligation quote with pricing, terms, and estimated travel times.",
  "Transporte turístico premium con base en Manta, sirviendo todo el Ecuador.": "Premium tourism transportation based in Manta, serving destinations throughout Ecuador.",
  "Enlaces": "Links",
  "Volver al inicio de la página": "Back to top",
  "Perfil": "Profile",
  "Inicio": "Home",
  "Cotizar": "Get a quote",
  "Historial": "History",
  "Panel Cliente": "Customer Portal",
  "Portal Cliente": "Customer Portal",
  "Navegacion Cliente": "CUSTOMER NAVIGATION",
  "Cliente": "Customer",
  "Cerrar sesión": "Log out",
  "CERRAR SESIÓN": "LOG OUT",
  "Viajes disponibles": "Available trips",
  "Selecciona un viaje con precio y capacidad de personas definida.": "Choose a trip with a set price and passenger capacity.",
  "Mis pagos": "My payments",
  "Vehículo por confirmar": "Vehicle to be confirmed",
  "Hora por definir": "Time to be confirmed",
  "Vehículo: ": "Vehicle: ",
  " personas": " people",
  " disponibles": " available",
  "Reservar este viaje": "Book this trip",
  "Sin personas disponibles": "No seats available",
  "No hay viajes publicados en este momento.": "There are no published trips at the moment.",
  "Confirmar compra": "Confirm booking",
  " por persona": " per person",
  "Capacidad del vehículo: ": "Vehicle capacity: ",
  "Personas que van": "Number of passengers",
  "Fecha del viaje": "Trip date",
  "Hora de salida": "Departure time",
  "Ubicación de recogida": "Pickup location",
  "Dirección o punto de encuentro": "Address or meeting point",
  "Referencia (opcional)": "Reference (optional)",
  "Ej.: junto a la farmacia, puerta azul...": "e.g., next to the pharmacy, blue door...",
  "Registrando...": "Registering...",
  "Confirmar reserva": "Confirm booking",
  "Tu viaje en curso": "Your trip in progress",
  "Tu próximo viaje": "Your next trip",
  "Ver historial": "View history",
  "El seguimiento en vivo estará disponible cuando el conductor inicie el viaje.": "Live tracking will be available when your driver starts the trip.",
  "Cotizar viaje": "Get a quote",
  "Mi historial": "My history",
  "En revisión": "Under review",
  "Aprobadas": "Approved",
  "Mis viajes": "My trips",
  "En curso": "In progress",
  "Compra directa": "Book a published trip",
  "¿Cómo funciona?": "How does it work?",
  "Elige vehículo, fecha, duración y propón un valor.": "Choose a vehicle, date, duration, and suggest a price.",
  "El administrador revisa y define el precio final.": "The administrator reviews your request and sets the final price.",
  "Se crea tu reserva con vehículo y conductor asignados.": "Your booking is created with a vehicle and driver assigned.",
  "Acuerdo": "Agreement",
  "Viaja": "Travel",
  "Ocultar formulario": "Hide form",
  "Nueva solicitud de servicio": "New service request",
  "Paso ": "Step ",
  " de 4": " of 4",
  "Ruta": "Route",
  "Vehículo": "Vehicle",
  "Fecha y pasajeros": "Date and passengers",
  "Vehículo y modalidad": "Vehicle and service type",
  "Resumen": "Summary",
  "¿A dónde necesitas viajar?": "Where would you like to go?",
  "Indica tu punto de salida y destino. Puedes buscar una dirección o ajustar el marcador en el mapa.": "Enter your pickup and destination. You can search for an address or adjust the map marker.",
  "¿Cuándo será tu viaje?": "When is your trip?",
  "Elige la fecha, horario y pasajeros. Si necesitas varios días o regresar después, selecciona la opción correspondiente.": "Choose your date, time, and passenger count. Select the appropriate option for multi-day trips or a later return.",
  "Elige una categoría": "Choose a vehicle category",
  "Selecciona la categoría que prefieres. La unidad específica se asignará después de confirmar el pago.": "Choose your preferred category. The specific vehicle will be assigned after payment is confirmed.",
  "Revisa antes de enviar": "Review before submitting",
  "Confirma que los datos del viaje sean correctos. Administración revisará tu solicitud y te enviará el precio.": "Confirm your trip details are correct. The team will review your request and send you a quote.",
  "Resumen del viaje": "Trip summary",
  "Salida": "Pickup",
  "Fecha y horario": "Date and time",
  "Recogida de regreso": "Return pickup",
  "Pasajeros y categoría": "Passengers and category",
  "Modalidad y viajes": "Service type and trips",
  "Por día": "By the day",
  "Esta solicitud no confirma una reserva ni asigna un vehículo todavía. Recibirás el precio para revisarlo y, si lo aceptas, podrás pagar el anticipo; Despacho asignará la unidad después de confirmar el pago.": "This request does not confirm a booking or assign a vehicle yet. You will receive a quote to review and, if you accept it, you can pay the deposit; Dispatch will assign the vehicle after payment is confirmed.",
  "Podrás seguir el estado y aceptar la cotización desde tu historial. No necesitas elegir una unidad ahora; se asignará después de confirmar el pago.": "You can track the status and accept the quote from your history. You do not need to choose a specific vehicle now; one will be assigned after payment is confirmed.",
  "Ir a mi historial": "Go to my history",
  "Pasos de la solicitud": "Request steps",
  "Progreso de solicitud": "Request progress",
  "Requerimiento personalizado": "Custom request",
  "¿Necesitas varios vehículos o un servicio especial? Cuéntanos todos los detalles.": "Need several vehicles or a special service? Tell us all the details.",
  "Describe aquí solicitudes que requieren coordinación especial, por ejemplo, grupos grandes, varios buses, más de una ruta, horarios escalonados, paradas o servicios para una empresa. Enviar el requerimiento no confirma disponibilidad ni reserva unidades.": "Use this form for requests that need special coordination, such as large groups, multiple buses or routes, staggered schedules, stops, or company services. Sending a request does not confirm availability or reserve vehicles.",
  "Empresa u organización (opcional)": "Company or organization (optional)",
  "Nombre de la empresa": "Company name",
  "Cantidad de vehículos *": "Number of vehicles *",
  "Tipo de vehículo preferido": "Preferred vehicle type",
  "Ej: bus de 40 pasajeros": "e.g., 40-passenger bus",
  "Pasajeros por vehículo": "Passengers per vehicle",
  "Fecha de inicio": "Start date",
  "Fecha final (opcional)": "End date (optional)",
  "Hora de inicio (opcional)": "Start time (optional)",
  "Punto de salida (opcional)": "Pickup point (optional)",
  "Ciudad, dirección o lugar de encuentro": "City, address, or meeting point",
  "Destino o destinos (opcional)": "Destination(s) (optional)",
  "Puedes incluir varios destinos": "You can include multiple destinations",
  "Cuéntanos qué necesitas *": "Tell us what you need *",
  "Incluye todo lo importante: cantidad y tipo de vehículos, horarios de cada grupo, rutas, paradas, duración, equipaje, necesidades especiales y cualquier otro detalle para preparar la propuesta.": "Include everything important: vehicle count and type, each group's schedule, routes, stops, duration, luggage, special needs, and any other details needed to prepare a proposal.",
  "Enviando requerimiento...": "Sending request...",
  "Enviar requerimiento": "Send request",
  "Mis requerimientos personalizados": "My custom requests",
  "Grupos de servicio": "Service groups",
  "Cada grupo reúne vehículos que comparten tipo, ruta y horario. Agrega otro grupo si cambia alguno de esos datos.": "Each group combines vehicles that share a type, route, and schedule. Add another group if any of those details differ.",
  "Agregar grupo": "Add group",
  "Copiar ruta y horario anterior": "Copy previous route and schedule",
  "Quitar": "Remove",
  "Indicaciones para este grupo": "Instructions for this group",
  "Horarios escalonados, equipaje, necesidades especiales...": "Staggered schedules, luggage, special needs...",
  "Los vehículos de este grupo deben operar simultáneamente": "Vehicles in this group must operate simultaneously",
  "Operación simultánea solicitada": "Simultaneous operation requested",
  "Paradas": "Stops",
  "Destino por definir": "Destination to be determined",
  "Respondido": "Replied",
  "Cerrado": "Closed",
  "Solicitudes que requieren coordinación especial": "Requests that need special coordination",
  "Revisa la necesidad completa, evalúa disponibilidad propia o externa y deja una respuesta para que el cliente pueda verla en su cuenta.": "Review the full request, check in-house or external availability, and reply for the customer to see in their account.",
  "No hay requerimientos personalizados": "There are no custom requests",
  "Flota solicitada": "Requested fleet",
  "vehículo(s)": "vehicle(s)",
  "pasajeros por unidad": "passengers per vehicle",
  "Fechas y horario": "Dates and time",
  "Por definir": "To be determined",
  "Recorrido": "Route",
  "Salida por definir": "Pickup to be determined",
  "Destino(s) por definir": "Destination(s) to be determined",
  "Detalle enviado por el cliente": "Details from the customer",
  "Estado": "Status",
  "Respuesta visible para el cliente": "Response visible to the customer",
  "Indica disponibilidad, preguntas para aclarar o próximos pasos para preparar una propuesta.": "Share availability, questions, or next steps to prepare a proposal.",
  "Guardar y notificar al cliente": "Save and notify customer",
  " pasajeros": " passengers",
  "3. Elige una categoría de vehículo": "3. Choose a vehicle category",
  "Las fotos son referenciales y muestran vehículos de la flota por categoría. Esta selección es una preferencia, no reserva una unidad ni una placa específica; Despacho asignará el vehículo después de confirmar el pago.": "These are representative photos of fleet vehicles by category. Your selection is a preference, not a reservation of a specific vehicle or license plate; Dispatch will assign the vehicle after payment is confirmed.",
  "Foto referencial": "Representative photo",
  "Foto de esta categoría no disponible": "No photo available for this category",
  "Paga el total en tu Historial. Tras confirmar el pago, asignaremos el vehículo desde Despacho.": "Pay the total in your History. Once payment is confirmed, we will assign the vehicle through Dispatch.",
  "Ej: Su cotización fue aprobada. Tras confirmar el pago, asignaremos el vehículo desde Despacho.": "E.g. Your quote has been approved. Once payment is confirmed, we will assign the vehicle through Dispatch.",
  "Tarifa según servicio": "Rate depends on the service",
  "Base $": "Base $",
  " · varía por modalidad": " · varies by service type",
  "La estimación cambia según la categoría y la modalidad que elijas.": "The estimate changes based on your selected category and service type.",
  "Modalidad del servicio": "Service type",
  "Día completo": "Full day",
  "Medio día": "Half day",
  "Por horas": "By the hour",
  "Traslado": "Transfer",
  "Cantidad de horas": "Number of hours",
  "2. Fecha del servicio": "2. Service date",
  "Regreso en otra fecha": "Return on another date",
  "Te llevamos al destino y regresamos a recogerte en la fecha acordada para volver al punto de salida.": "We'll take you to your destination and return to pick you up on the agreed date to take you back to your departure point.",
  "Fecha de recogida": "Pickup date",
  "Hora de recogida": "Pickup time",
  "El regreso será desde el destino hasta el punto de salida original. No se cobrará como espera de varios días.": "The return will be from your destination to your original departure point. This will not be charged as a multi-day wait.",
  "Indica la fecha y hora para recoger al regreso.": "Enter the date and time for your return pickup.",
  "La fecha de regreso debe ser posterior a la fecha de salida.": "The return date must be after the departure date.",
  "Selecciona las fechas que prefieres. La disponibilidad final se confirma después de revisar tu solicitud.": "Select your preferred dates. Final availability will be confirmed after your request is reviewed.",
  "Selecciona la fecha de salida y luego el último día del servicio. La disponibilidad se confirma al revisar tu solicitud.": "Select the departure date and then the last day of service. Availability will be confirmed when your request is reviewed.",
  "Elige la fecha del viaje. Después seleccionarás la fecha de recogida de regreso.": "Choose the trip date. Then select the return pickup date.",
  "Elige la fecha de salida que prefieres. La disponibilidad final se confirma después de revisar tu solicitud.": "Choose your preferred departure date. Final availability will be confirmed after your request is reviewed.",
  "· máximo": "· maximum",
  "Un día": "One day",
  "Varios días": "Multiple days",
  "Del ": "From ",
  " al ": " to ",
  " días": " days",
  " — elige el último día": " — choose the last day",
  " · 1 día": " · 1 day",
  "Personas": "Passengers",
  "1. Indica la ruta": "1. Choose your route",
  "Usar mi ubicación actual": "Use my current location",
  "Detectando tu ubicación actual…": "Detecting your current location…",
  "Salida:": "Pickup:",
  "Regreso:": "Return:",
  "Ida ": "Outbound ",
  "Buscar salida": "Search pickup",
  "Buscar destino": "Search destination",
  "Ej.: Manta, Manabí": "E.g.: Manta, Manabí",
  "Ej.: Aeropuerto de Quito": "E.g.: Quito Airport",
  "Buscar": "Search",
  "Buscando": "Searching",
  "Escribe al menos 3 caracteres para buscar.": "Enter at least 3 characters to search.",
  "No se encontraron lugares en Ecuador. Prueba con otra búsqueda.": "No places were found in Ecuador. Try another search.",
  "No se pudo buscar la dirección. Inténtalo de nuevo.": "Could not search for the address. Try again.",
  "No se pudo buscar el lugar. Inténtalo de nuevo.": "Could not search for the place. Try again.",
  "Escribe una dirección y pulsa Buscar; luego selecciona un resultado. También puedes ajustar los puntos directamente en el mapa.": "Enter an address and press Search, then select a result. You can also adjust the points directly on the map.",
  "Calculando distancia por carretera…": "Calculating road distance…",
  "Distancia estimada: ": "Estimated distance: ",
  " km · Duración: ": " km · Duration: ",
  " min": " min",
  "Marca ambos puntos para calcular la distancia.": "Select both points to calculate the distance.",
  "4. Detalles y resumen": "4. Details and summary",
  "Viajes": "Trips",
  "Mensaje para el administrador (opcional)": "Message for the administrator (optional)",
  "Continuar": "Continue",
  "Enviando solicitud...": "Sending request...",
  "Solicitar servicio": "Request service",
  "Mis Cotizaciones": "My Quotes",
  "Aún no has cotizado": "You have not requested a quote yet",
  "Tienes una propuesta": "You have a proposal",
  "Aprobada ✓": "Approved ✓",
  "No disponible": "Unavailable",
  "El administrador te propone": "The administrator proposes",
  "Tu nueva propuesta ($)": "Your new offer ($)",
  "Tu contraoferta": "Your counteroffer",
  "Enviar": "Send",
  "Aceptar": "Accept",
  "Negociar": "Negotiate",
  "Rechazar": "Decline",
  "Valor ofrecido:": "Your offer:",
  "Fecha": "Date",
  "Duración": "Duration",
  "Cotización": "Quote",
  "Paga al menos el 50% en tu Historial para confirmarla.": "Pay at least 50% in your History to confirm it.",
  "Historial de Viajes": "Trip History",
  "Aún no tienes viajes": "You have no trips yet",
  "Tus reservas aparecerán aquí cuando una cotización sea aprobada.": "Your bookings will appear here once a quote is approved.",
  "Por asignar": "To be assigned",
  "Conductor": "Driver",
  "Pagado completo": "Paid in full",
  "Pago confirmado": "Payment confirmed",
  "Pago parcial": "Partial payment",
  "Pago pendiente": "Payment pending",
  "Pendiente de pago": "Payment due",
  "Pagado": "Paid",
  "Abono: $": "Paid: $",
  " · Falta: $": " · Balance: $",
  "Ver proforma": "View pro forma",
  "Pagar mi reserva": "Pay for my booking",
  "Este viaje no cuenta como realizado porque el pago no está confirmado.": "This trip is not marked as completed because the payment has not been confirmed.",
  "Ocultar mapa": "Hide map",
  "Seguir mi viaje en vivo": "Track my trip live",
  "Cambiar fecha u hora de salida": "Change departure date or time",
  "Tu calificación:": "Your rating:",
  "Calificar viaje": "Rate trip",
  "Cancelar": "Cancel",
  "Guardar cambio": "Save changes",
  "Selecciona una fecha.": "Select a date.",
  "Pagar reserva #": "Pay for booking #",
  "Mínimo 50% para asegurar tu viaje": "A 50% deposit is required to secure your trip",
  "Mínimo (50%)": "Minimum (50%)",
  "¿Cómo vas a pagar?": "How would you like to pay?",
  "Transferencia": "Bank transfer",
  "PayPhone / Tarjeta": "PayPhone / Card",
  "Pago seguro con PayPhone": "Secure payment with PayPhone",
  "Serás enviado al formulario seguro de PayPhone para pagar con tarjeta. Turesma no guarda datos de tu tarjeta.": "You will be redirected to PayPhone's secure form to pay by card. Turesma does not store your card details.",
  "Banco:": "Bank:",
  "Cuenta Corriente:": "Checking account:",
  "Titular:": "Account holder:",
  "RUC:": "Tax ID:",
  "Monto que estás pagando ($) *": "Payment amount ($) *",
  "Comprobante (imagen) *": "Payment receipt (image) *",
  "Selecciona una imagen": "Choose an image",
  "Subiendo imagen...": "Uploading image...",
  "Enviando...": "Sending...",
  "Continuar con PayPhone": "Continue with PayPhone",
  "Enviar comprobante": "Submit receipt",
  "Comprobantes enviados": "Submitted receipts",
  "Recibo": "Receipt",
  "Cambiar fecha/hora": "Change date/time",
  "Nueva fecha": "New date",
  "Nueva hora": "New time",
  "Guardar": "Save",
  "Ver mapa": "View map",
  "Ver comprobante": "View receipt",
  "Verificado": "Verified",
  "Sin verificar": "Not verified",
  "Perfil actualizado correctamente": "Profile updated successfully",
  "Datos personales": "Personal information",
  "Verificación de identidad": "Identity verification",
  "Tu identidad está verificada. Ya puedes solicitar y confirmar tus servicios sin restricciones.": "Your identity is verified. You can now request and confirm services without restrictions.",
  "Revisa tu correo y abre el enlace de verificación para confirmar tu identidad.": "Check your email and open the verification link to confirm your identity.",
  "Para solicitar servicios necesitas verificar tu identidad. Ingresa tu número de cédula y confirma tu correo electrónico.": "To request services, verify your identity. Enter your ID number and confirm your email address.",
  "Número de cédula": "ID number",
  "10 dígitos": "10 digits",
  "Enviar enlace de verificación": "Send verification link",
  "Nombre": "Name",
  "Teléfono": "Phone",
  "Correo (no editable)": "Email (cannot be changed)",
  "Cambiar contraseña": "Change password",
  "(opcional — déjalo en blanco si no la cambias)": "(optional — leave blank to keep your current password)",
  "Nueva contraseña": "New password",
  "Confirmar": "Confirm",
  "Guardando...": "Saving...",
  "Guardar cambios": "Save changes",
  "Asistente": "Assistant",
  "Quiero cotizar un viaje": "I want to get a trip quote",
  "¿Cuánto cuesta un Van?": "How much does a van cost?",
  "¿Hay descuentos disponibles?": "Are there any discounts?",
  "¿Dónde veo mis reservas?": "Where can I see my bookings?",
  "Escribe tu consulta y te ayudaré con la información más importante.": "Type your question and I will help you with the key information.",
  "¡Hola! Soy tu asistente de Turesma. Puedo ayudarte con cotizaciones, pagos, reservas, historial y perfil. ¿En qué te puedo apoyar?": "Hi! I am your Turesma assistant. I can help with quotes, payments, bookings, history, and your profile. What can I help you with?",
  "¡Hola! Puedo orientarte para cotizar, revisar tus reservas o consultar cómo se calcula el precio. ¿Qué necesitas hacer?": "Hi! I can help you request a quote, review your bookings, or understand pricing. What would you like to do?",
  "Ir a Cotizar": "Go to Quotes",
  "Cotizar mi viaje": "Get a trip quote",
  "Consultar cotización": "View quote",
  "Ver mis reservas": "View my bookings",
  "Abrir historial": "Open history",
  "Ir a mi perfil": "Go to my profile",
  "Buscar mi reserva": "Find my booking",
  "Ver estado de mis reservas": "View booking status",
  "Empezar una cotización": "Start a quote",
  "Enviar mensaje": "Send message",
  "Escribe tu mensaje...": "Type your message...",
  "Abrir chatbot": "Open chat assistant",
  "Cerrar chatbot": "Close chat assistant",
  "Ayuda": "Help",
  "Pronto agregaremos nuestra flota": "Our fleet will be available soon",
  "Traslado puntual": "One-way transfer",
  "Hasta": "Up to",
  "Detalla lo que necesitas: equipaje especial, paradas, aire acondicionado, guía turístico, hora de regreso, etc.": "Describe what you need: special luggage, stops, air conditioning, a tour guide, return time, and so on.",
  "Estimación referencial": "Estimated price",
  "Oferta del día:": "Today's offer:",
  "Servicio: $": "Service: $",
  "Km: $": "Distance: $",
  "Peajes: $": "Tolls: $",
  "Descuento: -$": "Discount: -$",
  "El total final se calcula al enviar la solicitud y puede variar ligeramente por la distancia de ruta. La fecha y el vehículo quedan sujetos a confirmación.": "The final total is calculated when you submit your request and may vary slightly based on route distance. The date and vehicle are subject to confirmation.",
  "Logística de eventos": "Event transportation",
  "Mi perfil": "My profile",
  "Rechazado:": "Rejected:",
  "Vuelve a intentarlo.": "Please try again.",
  "Comentario (opcional)": "Comment (optional)",
  "Califica:": "Rate:",
  "Calificar este viaje": "Rate this trip",
  "Confirmada": "Confirmed",
  "Finalizada": "Completed",
  "Pendiente": "Pending",
  "aprobado": "Approved",
  "rechazado": "Rejected",
  "pendiente": "Pending",
  "Pago aprobado": "Payment approved",
  "Pago rechazado": "Payment rejected",
  "Total": "Total",
  "Banco Pichincha": "Banco Pichincha",
  "Número de cuenta": "Account number",
  "Monto a pagar": "Payment amount",
  "Comprobante de pago": "Payment receipt",
  "Seleccionar archivo": "Choose file",
  "No se pudo enviar el pago": "Could not submit the payment",
  "Comprobante enviado. El administrador lo revisará pronto.": "Receipt submitted. The administrator will review it soon.",
  "Fecha/hora actualizada. Avisamos al administrador y al conductor.": "Date/time updated. The administrator and driver have been notified.",
  "¡Gracias por calificar!": "Thank you for your rating!",
  "El estado muestra en qué etapa está el servicio. Para explicarte el estado de una reserva concreta, revisa el detalle en tu historial.": "The status shows the current stage of your service. To learn about a specific booking, check its details in your history.",
  "En tu historial puedes consultar tus reservas, su estado y los datos del servicio.": "You can review your bookings, their status, and service details in your history.",
  "Puedes revisar los pagos y el detalle de cada servicio desde tu historial. Si tienes una duda sobre un cobro específico, ten a mano la reserva relacionada para que el equipo pueda ayudarte.": "You can review payments and service details in your history. If you have a question about a specific charge, have the related booking information ready so our team can help.",
  "La mejor opción depende principalmente del número de pasajeros y la ruta. En Cotizar puedes revisar los vehículos disponibles y su capacidad; si me dices cuántas personas viajan, puedo orientarte sobre qué capacidad buscar.": "The best option depends on the number of passengers and the route. In Quotes, you can review available vehicles and their capacity; tell me how many people are traveling and I can help you choose.",
  "El valor depende del origen, destino, fecha, número de pasajeros y vehículo. No quiero darte un precio aproximado que pueda ser incorrecto: completa esos datos y verás el cálculo vigente antes de enviar la solicitud.": "The price depends on your pickup, destination, date, passenger count, and vehicle. To avoid giving you an inaccurate estimate, enter those details to see current pricing before submitting your request.",
  "No puedo confirmar desde aquí si hay una promoción activa. Si hay un descuento vigente para tu viaje, se mostrará en el desglose de la cotización antes de que la envíes.": "I cannot confirm from here whether a promotion is active. If a discount applies to your trip, it will appear in the quote breakdown before you submit it.",
  "¡Con gusto! Si necesitas algo más sobre tu viaje o reserva, aquí estoy.": "You are welcome! I am here if you need anything else about your trip or booking.",
  "Las opciones para cambiar o cancelar dependen del estado y la fecha de tu reserva. Revisa primero el servicio en tu historial; si no aparece una opción para gestionarlo, contacta al equipo de Turesma.": "Options to change or cancel depend on your booking status and date. Check the service in your history first; if there is no option to manage it, contact the Turesma team.",
  "No tengo suficiente información para responder eso con seguridad. Puedo orientarte sobre cotizaciones, precios, vehículos, pagos, reservas e información de tu perfil.": "I do not have enough information to answer that confidently. I can help with quotes, pricing, vehicles, payments, bookings, and your profile.",
  "Puedo ayudarte con ese tema, pero necesito un poco más de detalle para orientarte correctamente. ¿Quieres consultar un precio, una reserva o un vehículo?": "I can help with that, but I need a little more detail. Would you like to ask about pricing, a booking, or a vehicle?",
  "Tenemos tarifas diferenciadas por tipo de vehículo: Van, Bus, SUV, Minibus y Sedan. El precio cambia según capacidad, tipo de ruta y si aplica la oferta del día. Puedes verlo en la cotización antes de enviar tu solicitud.": "We offer different rates for each vehicle type: van, bus, SUV, minibus, and sedan. Prices vary by capacity, route, and any active offers. You can review the price in your quote before submitting your request.",
  "La oferta del día depende de la configuración del administrador. Si está activa, se verá reflejada en el cálculo del total y aparecerá como descuento en la estimación.": "Today's offer depends on the administrator's settings. If active, it will be reflected in the total and shown as a discount in your estimate.",
  "Para cotizar, completa origen, destino, fecha, pasajeros y tipo de vehículo. El sistema calcula el costo real con los precios vigentes y te muestra una estimación antes de enviar la solicitud.": "To get a quote, enter your pickup, destination, date, passengers, and vehicle type. The system calculates the current price and shows an estimate before you submit your request.",
  "Puedes ver todas tus reservas y viajes en la sección Historial del cliente, donde aparece el estado actual y los datos del servicio.": "You can see all your bookings and trips in the customer History section, along with their current status and service details.",
  "Tu perfil se administra desde la opción Perfil. Desde ahí puedes revisar tus datos personales, imagen y la información asociada a tus viajes y cotizaciones.": "Manage your account in Profile. You can review your personal details, photo, and information related to your trips and quotes.",
  "Los estados indican el avance del servicio: pendiente está en revisión, aprobada o confirmada quedó listo, en curso ya está activo y cancelada fue anulada.": "Statuses show the progress of your service: pending means under review, approved or confirmed means arranged, in progress means active, and cancelled means it was called off.",
  "Haz clic en el mapa para fijar el punto de recogida": "Click the map to set the pickup location",
  "Haz clic en el mapa para fijar el destino": "Click the map to set the destination",
  "el punto de recogida": "the pickup location",
  "el destino": "the destination",
  "Marcar punto de recogida": "Set pickup location",
  "Obteniendo ubicación...": "Getting your location...",
  "Usar ubicación actual": "Use current location",
  "Tu dispositivo no permite obtener la ubicación actual.": "Your device does not support location access.",
  "No se pudo obtener tu ubicación. Revisa el permiso del navegador.": "Could not get your location. Check your browser permissions.",
  "Marcar salida": "Set pickup",
  "Marcar destino": "Set destination",
  "Obteniendo dirección…": "Getting address…",
  "Recogida": "Pickup",
  "Destino": "Destination",
  "Sin marcar": "Not set",
  "Selecciona un vehículo para ver sus días disponibles": "Select a vehicle to see available dates",
  "Toca el día de inicio del viaje": "Select the first day of your trip",
  "Ahora toca el último día del viaje": "Now select the last day of your trip",
  "Rango seleccionado — toca otro día para cambiarlo": "Date range selected — select another day to change it",
  "Elige la fecha de salida": "Choose the departure date",
  "Ahora elige el último día del servicio": "Now choose the last day of service",
  "Rango listo · elige otra fecha para empezar de nuevo": "Date range ready · choose another date to start over",
  "Elige el día de tu viaje": "Choose your trip date",
  "Selecciona fecha de recogida": "Select the return pickup date",
  "El rango incluye fechas no disponibles. Elige otro rango.": "The range includes unavailable dates. Choose another range.",
  "Tu elección": "Your selection",
  "Días pasados": "Past dates",
  "Antes de fecha permitida": "Before the allowed date",
  "Libre": "Available",
  "Reservado": "Booked",
  " · máx. ": " · max ",
  "Regreso": "Return",
  "días": "days",
  "Mes anterior": "Previous month",
  "Mes siguiente": "Next month",
  "Seguimiento en vivo": "Live tracking",
  " · actualizado ": " · updated ",
  "Llega en ~": "Arrives in ~",
  "El conductor aún no comparte su ubicación": "The driver has not shared their location yet",
  "Conductor por asignar": "Driver to be assigned",
  "Destino fijado": "Destination set",
  "Abrir notificaciones": "Open notifications",
  "Notificaciones": "Notifications",
  "Marcar leidas": "Mark as read",
  "Cargando notificaciones...": "Loading notifications...",
  "No tienes notificaciones.": "You have no notifications.",
  "Nueva notificación": "New notification",
  "Cerrar": "Close",
  "Escribe tu duda...": "Type your question...",
  "Reserva #": "Booking #",
  "Se avisará por correo al cliente y se actualizará al administrador y al conductor.": "The customer will be notified by email, and the administrator and driver will be updated.",
  "Nueva fecha de salida": "New departure date",
  "Nueva hora de salida": "New departure time",
  "Si dejas la hora vacía, se mantiene la hora actual.": "Leave the time blank to keep the current time.",
  "Cambiar fecha u hora": "Change date or time",
  "Ahora": "Now",
  "Hoy": "Today",
  "Enero": "January",
  "Febrero": "February",
  "Marzo": "March",
  "Abril": "April",
  "Mayo": "May",
  "Junio": "June",
  "Julio": "July",
  "Agosto": "August",
  "Septiembre": "September",
  "Octubre": "October",
  "Noviembre": "November",
  "Diciembre": "December",
  "Sobre Nosotros": "About Us",
  "Nuestra esencia": "Our Essence",
  "Misión": "Mission",
  "Visión": "Vision",
  "Nuestra Flota": "Our Fleet",
  "¿Por qué elegirnos?": "Why Choose Us?",
  "Logística": "Logistics",
  "Ubicación": "Location",
  "Atención 24 Horas": "24-Hour Support",
  "Turismo VIP": "VIP Travel",
  "Seguridad 24/7": "24/7 Safety",
  "Puntualidad": "Punctuality",
  "Seguridad, confianza y excelencia en cada camino.": "Safety, trust, and excellence on every journey.",
  "Seguros de Pasajeros": "Passenger Insurance",
  "Email Oficial": "Official Email",
  "Rastreo Satelital GPS": "GPS Tracking",
  "Video de Turesma": "Turesma video",
  "Turesma S.A. · Transporte Turístico": "Turesma S.A. · Tourism Transportation",
  "Turesma S.A., inicio": "Turesma S.A., home",
  "Bus de turismo": "Tourist bus",
  "Contactar a Turesma por WhatsApp": "Contact Turesma on WhatsApp",
  "Pausar video": "Pause video",
  "Reproducir video": "Play video",
  "Activar sonido": "Turn sound on",
  "Silenciar video": "Mute video",
  "Las contraseñas no coinciden": "The passwords do not match",
  "La contraseña debe tener al menos 6 caracteres": "The password must be at least 6 characters long",
  "La cédula debe tener 10 dígitos": "The ID number must contain 10 digits",
  "Documento enviado para verificación": "Document submitted for verification",
  "Ingresa el valor que propones": "Enter the amount you are proposing",
  "Listo": "Done",
  "Revisa estas opciones para tu viaje.": "Review these options for your trip.",
  "No se pudo consultar al asistente": "Could not reach the assistant",
  "Marca el punto de salida y el destino en el mapa.": "Set your pickup and destination on the map.",
  "Selecciona la fecha de inicio del servicio.": "Select the service start date.",
  "Toca también el último día del viaje en el calendario.": "Select the last day of the trip on the calendar as well.",
  "Selecciona una categoría de vehículo disponible.": "Select an available vehicle category.",
  "No hay categorías de vehículos disponibles en este momento.": "There are no vehicle categories available at the moment.",
  "No se pudo descargar el recibo": "Could not download the receipt",
  "Ingresa un monto válido": "Enter a valid amount",
  "Adjunta una imagen del comprobante": "Attach an image of the receipt",
  "Pago PayPhone confirmado correctamente": "PayPhone payment confirmed successfully",
  "Error inesperado": "An unexpected error occurred",
  "Tipo de servicio": "Service type",
  "Reserva creada": "Booking created",
  "Datos para transferencia": "Bank transfer details",
  "Comprobante enviado": "Receipt submitted",
  "No se pudo cambiar la fecha/hora": "Could not change the date/time",
  " creada — pendiente de pago": " created — payment pending",
  "Volver": "Back",
  "Tus notas": "Your notes",
  "Precio acordado": "Agreed price",
  "Respuesta de Turesma": "Turesma's response",
  "Ver vehículos": "View vehicles",
  "Hace instantes": "Moments ago",
  "Los datos de tu cuenta se actualizaron correctamente.": "Your account details were updated successfully.",
};

const localeContext = createContext<{ language: Language; setLanguage: (language: Language) => void }>({
  language: "es",
  setLanguage: () => undefined,
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("es");

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_KEY);
    if (saved === "en" || saved === "es") setLanguageState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "es";
  }, [language]);

  const setLanguage = (next: Language) => {
    window.localStorage.setItem(LANGUAGE_KEY, next);
    setLanguageState(next);
  };

  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <localeContext.Provider value={value}>{children}</localeContext.Provider>;
}

export function useLocale() {
  return useContext(localeContext);
}

export function formatLocalizedDate(value: string, language: Language) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "es-EC").format(date);
}

export function LanguageSwitcher({ compactOnMobile = false }: { compactOnMobile?: boolean }) {
  const { language, setLanguage } = useLocale();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div
      className="relative"
      role="group"
      aria-label={language === "en" ? "Language selection" : "Selección de idioma"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={language === "en" ? "Language" : "Idioma"}
        className={`inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 bg-white py-2 text-xs font-bold text-gray-700 shadow-sm transition hover:border-[#E31E24] hover:text-[#E31E24] ${compactOnMobile ? "px-2 sm:px-3" : "px-3"} ${compactOnMobile ? "max-sm:gap-1" : ""}`}
      >
        <span aria-hidden="true">{language === "en" ? "🇬🇧" : "🇪🇸"}</span>
        <span className={compactOnMobile ? "max-sm:hidden" : ""}>{language === "en" ? "Language" : "Idioma"}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-[80] mt-2 min-w-40 overflow-hidden rounded-xl border border-red-700 bg-[#E31E24] p-1.5 shadow-xl">
          <button
            type="button"
            aria-pressed={language === "en"}
            onClick={() => { setLanguage("en"); setOpen(false); }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-white transition hover:bg-black/15 ${language === "en" ? "bg-black/15" : ""}`}
          >
            <span aria-hidden="true">🇬🇧</span> English
          </button>
          <button
            type="button"
            aria-pressed={language === "es"}
            onClick={() => { setLanguage("es"); setOpen(false); }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-white transition hover:bg-black/15 ${language === "es" ? "bg-black/15" : ""}`}
          >
            <span aria-hidden="true">🇪🇸</span> Español
          </button>
        </div>
      )}
    </div>
  );
}

const translate = (value: string, language: Language) => {
  if (language !== "en") return value;
  const exactTranslation = translations[value];
  if (exactTranslation !== undefined) return exactTranslation;

  const leading = value.match(/^\s*/)?.[0] || "";
  const trailing = value.match(/\s*$/)?.[0] || "";
  const content = value.slice(leading.length, value.length - trailing.length);
  const passengerCount = content.match(/^(\d+) Pasajeros$/);
  const routeEstimate = content.match(/^Distancia estimada: (.+?) km · Duración: (.+?) min$/);
  const paidBalance = content.match(/^Abono: (\$[\d,.]+) · Falta: (\$[\d,.]+)$/);
  const rangeLimit = content.match(/^· máx\. (\d+) días$/);
  const dayCount = content.match(/^· (\d+) días$/);
  const selectedDayCount = content.match(/^(\d+) días$/);
  const tripCount = content.match(/^(\d+) viajes?$/);
  const hourlyService = content.match(/^Por horas · (\d+) h$/);
  const maximumDays = content.match(/^Máximo (\d+) días seguidos por reserva\.$/);
  const calendarSelection = content.match(/^(Fecha de recogida|Fecha seleccionada): (.+)$/);
  const calendarMaxDays = content.match(/^· máximo (\d+) días$/);
  const capacity = content.match(/^Hasta (\d+) pasajeros$/);
  const selectedCapacity = content.match(/^La categoría seleccionada admite hasta (\d+) pasajeros\. Elige otra categoría\.$/);
  const maxServiceDays = content.match(/^El servicio no puede superar los (\d+) días seguidos\.$/);
  const bookingMessage = content.match(/^Solicitud de reserva creada(?: por (\$[\d,.]+))?\. Ve a Historial para pagar el anticipo indicado; administración verificará el pago antes de confirmar la reserva y asignar el vehículo\.$/);
  const newBooking = content.match(/^Reserva #(\d+) creada — pendiente de pago$/);
  const customRequestSent = content.match(/^Requerimiento #(\d+) enviado\. El equipo revisará los detalles y responderá desde aquí\.$/);
  const customRequestId = content.match(/^Requerimiento #(\d+)$/);
  const dailyOffer = content.match(/^Oferta del día: (.+)$/);
  const relativeTime = content.match(/^Hace (\d+) (min|h|d)$/);
  const translated = translations[content]
    ?? (passengerCount ? `${passengerCount[1]} Passengers` : undefined)
    ?? (routeEstimate ? `Estimated distance: ${routeEstimate[1]} km · Duration: ${routeEstimate[2]} min` : undefined)
    ?? (paidBalance ? `Paid: ${paidBalance[1]} · Balance: ${paidBalance[2]}` : undefined)
    ?? (rangeLimit ? `· max ${rangeLimit[1]} days` : undefined)
    ?? (dayCount ? `· ${dayCount[1]} days` : undefined)
    ?? (selectedDayCount ? `${selectedDayCount[1]} days` : undefined)
    ?? (tripCount ? `${tripCount[1]} trip${tripCount[1] === "1" ? "" : "s"}` : undefined)
    ?? (hourlyService ? `By the hour · ${hourlyService[1]} hr` : undefined)
    ?? (maximumDays ? `Maximum ${maximumDays[1]} consecutive days per booking.` : undefined)
    ?? (calendarSelection ? `${calendarSelection[1] === "Fecha de recogida" ? "Pickup date" : "Selected date"}: ${calendarSelection[2]}` : undefined)
    ?? (calendarMaxDays ? `· maximum ${calendarMaxDays[1]} days` : undefined)
    ?? (capacity ? `Up to ${capacity[1]} passengers` : undefined)
    ?? (selectedCapacity ? `The selected category accommodates up to ${selectedCapacity[1]} passengers. Choose another category.` : undefined)
    ?? (maxServiceDays ? `The service cannot exceed ${maxServiceDays[1]} consecutive days.` : undefined)
    ?? (bookingMessage ? `Booking request created${bookingMessage[1] ? ` for ${bookingMessage[1]}` : ""}. Go to History to pay the requested deposit; the administrator will verify your payment before confirming the booking and assigning a vehicle.` : undefined)
    ?? (newBooking ? `Booking #${newBooking[1]} created — payment pending` : undefined)
    ?? (customRequestSent ? `Request #${customRequestSent[1]} sent. The team will review the details and reply here.` : undefined)
    ?? (customRequestId ? `Request #${customRequestId[1]}` : undefined)
    ?? (dailyOffer ? `Today's offer: ${dailyOffer[1]}` : undefined)
    ?? (relativeTime ? `${relativeTime[1]} ${relativeTime[2] === "h" ? "hr" : relativeTime[2]} ago` : content);
  return `${leading}${translated}${trailing}`;
};

export function LocalizedContent({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const { language } = useLocale();
  if (!enabled) return <>{children}</>;

  const localizeNode = (node: ReactNode): ReactNode => {
    if (typeof node === "string") return translate(node, language);
    if (Array.isArray(node)) {
      return node.map((child, index) => {
        const localizedChild = localizeNode(child);
        if (isValidElement(localizedChild) && localizedChild.key === null) {
          return cloneElement(localizedChild, { key: `localized-${index}` });
        }
        return localizedChild;
      });
    }
    if (!isValidElement<{
      children?: ReactNode;
      title?: string;
      placeholder?: string;
      alt?: string;
      "aria-label"?: string;
      "data-no-translate"?: boolean | string;
    }>(node)) return node;

    const props = node.props;
    if (props["data-no-translate"]) return node;
    if (node.type === Fragment) {
      return cloneElement(node, { children: localizeNode(props.children) });
    }
    return cloneElement(node, {
      ...props,
      title: props.title ? translate(props.title, language) : undefined,
      placeholder: props.placeholder ? translate(props.placeholder, language) : undefined,
      alt: props.alt ? translate(props.alt, language) : undefined,
      "aria-label": props["aria-label"] ? translate(props["aria-label"], language) : undefined,
      children: localizeNode(props.children),
    });
  };

  return <>{localizeNode(children)}</>;
}
