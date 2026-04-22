import 'dotenv/config';
import { getPool, closePool } from './connection';
import { logger } from '../utils/logger';

// ── Top 100 US airports ───────────────────────────────────────────────────────
const AIRPORTS: [string, string, string, string, string, string][] = [
  // [iata, icao, name, city, country, metro_area]
  ['ATL', 'KATL', 'Hartsfield-Jackson Atlanta International', 'Atlanta', 'US', 'Atlanta, GA'],
  ['LAX', 'KLAX', 'Los Angeles International', 'Los Angeles', 'US', 'Los Angeles, CA'],
  ['ORD', 'KORD', "O'Hare International", 'Chicago', 'US', 'Chicago, IL'],
  ['DFW', 'KDFW', 'Dallas/Fort Worth International', 'Dallas', 'US', 'Dallas-Fort Worth, TX'],
  ['DEN', 'KDEN', 'Denver International', 'Denver', 'US', 'Denver, CO'],
  ['JFK', 'KJFK', 'John F. Kennedy International', 'New York', 'US', 'New York, NY'],
  ['SFO', 'KSFO', 'San Francisco International', 'San Francisco', 'US', 'San Francisco, CA'],
  ['SEA', 'KSEA', 'Seattle-Tacoma International', 'Seattle', 'US', 'Seattle, WA'],
  ['LAS', 'KLAS', 'Harry Reid International', 'Las Vegas', 'US', 'Las Vegas, NV'],
  ['MCO', 'KMCO', 'Orlando International', 'Orlando', 'US', 'Orlando, FL'],
  ['EWR', 'KEWR', 'Newark Liberty International', 'Newark', 'US', 'New York, NY'],
  ['MIA', 'KMIA', 'Miami International', 'Miami', 'US', 'Miami, FL'],
  ['PHX', 'KPHX', 'Phoenix Sky Harbor International', 'Phoenix', 'US', 'Phoenix, AZ'],
  ['IAH', 'KIAH', 'George Bush Intercontinental', 'Houston', 'US', 'Houston, TX'],
  ['BOS', 'KBOS', 'Logan International', 'Boston', 'US', 'Boston, MA'],
  ['MSP', 'KMSP', 'Minneapolis-Saint Paul International', 'Minneapolis', 'US', 'Minneapolis, MN'],
  ['DTW', 'KDTW', 'Detroit Metropolitan Wayne County', 'Detroit', 'US', 'Detroit, MI'],
  ['FLL', 'KFLL', 'Fort Lauderdale-Hollywood International', 'Fort Lauderdale', 'US', 'Miami, FL'],
  ['PHL', 'KPHL', 'Philadelphia International', 'Philadelphia', 'US', 'Philadelphia, PA'],
  ['LGA', 'KLGA', 'LaGuardia', 'New York', 'US', 'New York, NY'],
  ['BWI', 'KBWI', 'Baltimore/Washington International', 'Baltimore', 'US', 'Washington, DC'],
  ['DCA', 'KDCA', 'Ronald Reagan Washington National', 'Washington', 'US', 'Washington, DC'],
  ['IAD', 'KIAD', 'Washington Dulles International', 'Washington', 'US', 'Washington, DC'],
  ['MDW', 'KMDW', 'Chicago Midway International', 'Chicago', 'US', 'Chicago, IL'],
  ['SLC', 'KSLC', 'Salt Lake City International', 'Salt Lake City', 'US', 'Salt Lake City, UT'],
  ['SAN', 'KSAN', 'San Diego International', 'San Diego', 'US', 'San Diego, CA'],
  ['TPA', 'KTPA', 'Tampa International', 'Tampa', 'US', 'Tampa, FL'],
  ['HNL', 'PHNL', 'Daniel K. Inouye International', 'Honolulu', 'US', 'Honolulu, HI'],
  ['CLT', 'KCLT', 'Charlotte Douglas International', 'Charlotte', 'US', 'Charlotte, NC'],
  ['PDX', 'KPDX', 'Portland International', 'Portland', 'US', 'Portland, OR'],
  ['STL', 'KSTL', 'St. Louis Lambert International', 'St. Louis', 'US', 'St. Louis, MO'],
  ['HOU', 'KHOU', 'William P. Hobby', 'Houston', 'US', 'Houston, TX'],
  ['OAK', 'KOAK', 'Oakland International', 'Oakland', 'US', 'San Francisco, CA'],
  ['MCI', 'KMCI', 'Kansas City International', 'Kansas City', 'US', 'Kansas City, MO'],
  ['RDU', 'KRDU', 'Raleigh-Durham International', 'Raleigh', 'US', 'Raleigh-Durham, NC'],
  ['SJC', 'KSJC', 'Norman Y. Mineta San Jose International', 'San Jose', 'US', 'San Francisco, CA'],
  ['SMF', 'KSMF', 'Sacramento International', 'Sacramento', 'US', 'Sacramento, CA'],
  ['DAL', 'KDAL', 'Dallas Love Field', 'Dallas', 'US', 'Dallas-Fort Worth, TX'],
  ['IND', 'KIND', 'Indianapolis International', 'Indianapolis', 'US', 'Indianapolis, IN'],
  ['CMH', 'KCMH', 'John Glenn Columbus International', 'Columbus', 'US', 'Columbus, OH'],
  ['AUS', 'KAUS', 'Austin-Bergstrom International', 'Austin', 'US', 'Austin, TX'],
  ['MSY', 'KMSY', 'Louis Armstrong New Orleans International', 'New Orleans', 'US', 'New Orleans, LA'],
  ['MKE', 'KMKE', 'Milwaukee Mitchell International', 'Milwaukee', 'US', 'Milwaukee, WI'],
  ['SAT', 'KSAT', 'San Antonio International', 'San Antonio', 'US', 'San Antonio, TX'],
  ['SNA', 'KSNA', 'John Wayne Airport', 'Santa Ana', 'US', 'Los Angeles, CA'],
  ['PIT', 'KPIT', 'Pittsburgh International', 'Pittsburgh', 'US', 'Pittsburgh, PA'],
  ['OMA', 'KOMA', 'Eppley Airfield', 'Omaha', 'US', 'Omaha, NE'],
  ['BUF', 'KBUF', 'Buffalo Niagara International', 'Buffalo', 'US', 'Buffalo, NY'],
  ['ABQ', 'KABQ', 'Albuquerque International Sunport', 'Albuquerque', 'US', 'Albuquerque, NM'],
  ['BNA', 'KBNA', 'Nashville International', 'Nashville', 'US', 'Nashville, TN'],
  ['RIC', 'KRIC', 'Richmond International', 'Richmond', 'US', 'Richmond, VA'],
  ['JAX', 'KJAX', 'Jacksonville International', 'Jacksonville', 'US', 'Jacksonville, FL'],
  ['OKC', 'KOKC', 'Will Rogers World', 'Oklahoma City', 'US', 'Oklahoma City, OK'],
  ['TUL', 'KTUL', 'Tulsa International', 'Tulsa', 'US', 'Tulsa, OK'],
  ['GRR', 'KGRR', 'Gerald R. Ford International', 'Grand Rapids', 'US', 'Grand Rapids, MI'],
  ['BDL', 'KBDL', 'Bradley International', 'Windsor Locks', 'US', 'Hartford, CT'],
  ['BOI', 'KBOI', 'Boise Airport', 'Boise', 'US', 'Boise, ID'],
  ['TUS', 'KTUS', 'Tucson International', 'Tucson', 'US', 'Tucson, AZ'],
  ['MEM', 'KMEM', 'Memphis International', 'Memphis', 'US', 'Memphis, TN'],
  ['ONT', 'KONT', 'Ontario International', 'Ontario', 'US', 'Los Angeles, CA'],
  ['CLE', 'KCLE', 'Cleveland Hopkins International', 'Cleveland', 'US', 'Cleveland, OH'],
  ['SJU', 'TJSJ', 'Luis Muñoz Marín International', 'San Juan', 'US', 'San Juan, PR'],
  ['ELP', 'KELP', 'El Paso International', 'El Paso', 'US', 'El Paso, TX'],
  ['MHT', 'KMHT', 'Manchester-Boston Regional', 'Manchester', 'US', 'Boston, MA'],
  ['ALB', 'KALB', 'Albany International', 'Albany', 'US', 'Albany, NY'],
  ['ROC', 'KROC', 'Greater Rochester International', 'Rochester', 'US', 'Rochester, NY'],
  ['SYR', 'KSYR', 'Syracuse Hancock International', 'Syracuse', 'US', 'Syracuse, NY'],
  ['PVD', 'KPVD', 'T.F. Green Airport', 'Providence', 'US', 'Providence, RI'],
  ['ORF', 'KORF', 'Norfolk International', 'Norfolk', 'US', 'Norfolk, VA'],
  ['GSO', 'KGSO', 'Piedmont Triad International', 'Greensboro', 'US', 'Greensboro, NC'],
  ['CAE', 'KCAE', 'Columbia Metropolitan', 'Columbia', 'US', 'Columbia, SC'],
  ['CHS', 'KCHS', 'Charleston International', 'Charleston', 'US', 'Charleston, SC'],
  ['SAV', 'KSAV', 'Savannah/Hilton Head International', 'Savannah', 'US', 'Savannah, GA'],
  ['LIT', 'KLIT', 'Bill and Hillary Clinton National', 'Little Rock', 'US', 'Little Rock, AR'],
  ['ICT', 'KICT', 'Wichita Dwight D. Eisenhower National', 'Wichita', 'US', 'Wichita, KS'],
  ['AGS', 'KAGS', 'Augusta Regional', 'Augusta', 'US', 'Augusta, GA'],
  ['DSM', 'KDSM', 'Des Moines International', 'Des Moines', 'US', 'Des Moines, IA'],
  ['MDT', 'KMDT', 'Harrisburg International', 'Harrisburg', 'US', 'Harrisburg, PA'],
  ['ACY', 'KACY', 'Atlantic City International', 'Atlantic City', 'US', 'Philadelphia, PA'],
  ['SWF', 'KSWF', 'New York Stewart International', 'Newburgh', 'US', 'New York, NY'],
  ['HPN', 'KHPN', 'Westchester County', 'White Plains', 'US', 'New York, NY'],
  ['SFB', 'KSFB', 'Orlando Sanford International', 'Sanford', 'US', 'Orlando, FL'],
  ['PIE', 'KPIE', 'St. Pete-Clearwater International', 'Clearwater', 'US', 'Tampa, FL'],
  ['PNS', 'KPNS', 'Pensacola International', 'Pensacola', 'US', 'Pensacola, FL'],
  ['VPS', 'KVPS', 'Destin-Fort Walton Beach', 'Fort Walton Beach', 'US', 'Fort Walton Beach, FL'],
  ['MLB', 'KMLB', 'Melbourne Orlando International', 'Melbourne', 'US', 'Melbourne, FL'],
  ['DAY', 'KDAY', 'James M. Cox Dayton International', 'Dayton', 'US', 'Dayton, OH'],
  ['CVG', 'KCVG', 'Cincinnati/Northern Kentucky International', 'Cincinnati', 'US', 'Cincinnati, OH'],
  ['LBB', 'KLBB', 'Lubbock Preston Smith International', 'Lubbock', 'US', 'Lubbock, TX'],
  ['AMA', 'KAMA', 'Rick Husband Amarillo International', 'Amarillo', 'US', 'Amarillo, TX'],
  ['MAF', 'KMAF', 'Midland International Air & Space Port', 'Midland', 'US', 'Midland, TX'],
  ['FAT', 'KFAT', 'Fresno Yosemite International', 'Fresno', 'US', 'Fresno, CA'],
  ['BUR', 'KBUR', 'Hollywood Burbank', 'Burbank', 'US', 'Los Angeles, CA'],
  ['LGB', 'KLGB', 'Long Beach Airport', 'Long Beach', 'US', 'Los Angeles, CA'],
  ['GEG', 'KGEG', 'Spokane International', 'Spokane', 'US', 'Spokane, WA'],
  ['FAI', 'PAFA', 'Fairbanks International', 'Fairbanks', 'US', 'Fairbanks, AK'],
  ['ANC', 'PANC', 'Ted Stevens Anchorage International', 'Anchorage', 'US', 'Anchorage, AK'],
  ['OGG', 'PHOG', 'Kahului Airport', 'Kahului', 'US', 'Maui, HI'],
  ['KOA', 'PHKO', 'Ellison Onizuka Kona International', 'Kailua-Kona', 'US', 'Hawaii, HI'],
  ['LIH', 'PHLI', 'Lihue Airport', 'Lihue', 'US', 'Kauai, HI'],
];

// ── Top 50 US carriers ────────────────────────────────────────────────────────
const CARRIERS: [string, string, string, string, string][] = [
  // [iata, icao, name, country, type]
  ['AA', 'AAL', 'American Airlines', 'US', 'mainline'],
  ['DL', 'DAL', 'Delta Air Lines', 'US', 'mainline'],
  ['UA', 'UAL', 'United Airlines', 'US', 'mainline'],
  ['WN', 'SWA', 'Southwest Airlines', 'US', 'lowcost'],
  ['B6', 'JBU', 'JetBlue Airways', 'US', 'lowcost'],
  ['AS', 'ASA', 'Alaska Airlines', 'US', 'mainline'],
  ['NK', 'NKS', 'Spirit Airlines', 'US', 'lowcost'],
  ['F9', 'FFT', 'Frontier Airlines', 'US', 'lowcost'],
  ['G4', 'AAY', 'Allegiant Air', 'US', 'lowcost'],
  ['HA', 'HAL', 'Hawaiian Airlines', 'US', 'mainline'],
  ['SY', 'SCX', 'Sun Country Airlines', 'US', 'lowcost'],
  ['OO', 'SKW', 'SkyWest Airlines', 'US', 'regional'],
  ['YX', 'RPA', 'Republic Airways', 'US', 'regional'],
  ['9E', 'FLG', 'Endeavor Air', 'US', 'regional'],
  ['MQ', 'EGF', 'Envoy Air', 'US', 'regional'],
  ['OH', 'CAA', 'PSA Airlines', 'US', 'regional'],
  ['YV', 'MVT', 'Mesa Air Group', 'US', 'regional'],
  ['CP', 'CPZ', 'Compass Airlines', 'US', 'regional'],
  ['ZW', 'AWI', 'Air Wisconsin', 'US', 'regional'],
  ['PT', 'PDT', 'Piedmont Airlines', 'US', 'regional'],
  ['3M', 'SGF', 'Silver Airways', 'US', 'regional'],
  ['C5', 'UCA', 'CommutAir', 'US', 'regional'],
  ['QX', 'QXE', 'Horizon Air', 'US', 'regional'],
  ['KS', 'ERA', 'Era Alaska', 'US', 'regional'],
  ['8V', 'WRF', 'Wright Air Service', 'US', 'regional'],
  ['P9', 'GLR', 'Peach Air', 'US', 'regional'],
  ['XE', 'BTA', 'JSX', 'US', 'lowcost'],
  ['VX', 'VRD', 'Virgin America', 'US', 'lowcost'],
  ['WS', 'WJA', 'WestJet', 'CA', 'lowcost'],
  ['AC', 'ACA', 'Air Canada', 'CA', 'mainline'],
  ['MX', 'MXA', 'Mexicana', 'MX', 'mainline'],
  ['AM', 'AMX', 'Aeromexico', 'MX', 'mainline'],
  ['Y4', 'VOI', 'Volaris', 'MX', 'lowcost'],
  ['VB', 'VIV', 'VivaAerobus', 'MX', 'lowcost'],
  ['4O', 'AIJ', 'Interjet', 'MX', 'lowcost'],
  // LatAm / Caribbean — common on MIA/DFW/JFK/LAX international routes
  ['AV', 'AVA', 'Avianca', 'CO', 'mainline'],
  ['LR', 'LRC', 'Avianca Costa Rica (LACSA)', 'CR', 'mainline'],
  ['LA', 'LAN', 'LATAM Airlines', 'CL', 'mainline'],
  ['JJ', 'TAM', 'LATAM Brasil', 'BR', 'mainline'],
  ['CM', 'CMP', 'Copa Airlines', 'PA', 'mainline'],
  ['2K', 'GLG', 'Avianca Ecuador', 'EC', 'mainline'],
  ['H2', 'SKU', 'Sky Airline', 'CL', 'lowcost'],
  ['JA', 'JAT', 'JetSMART', 'CL', 'lowcost'],
  ['G3', 'GLO', 'Gol Linhas Aereas', 'BR', 'lowcost'],
  ['AD', 'AZU', 'Azul Brazilian Airlines', 'BR', 'lowcost'],
  ['AR', 'ARG', 'Aerolíneas Argentinas', 'AR', 'mainline'],
  ['P5', 'RPB', 'Wingo', 'CO', 'lowcost'],
  ['CU', 'CUB', 'Cubana de Aviación', 'CU', 'mainline'],
  ['BW', 'BWA', 'Caribbean Airlines', 'TT', 'mainline'],
  ['JM', 'JAM', 'Air Jamaica', 'JM', 'mainline'],
  ['B8', 'ECU', 'Eastern Airlines', 'US', 'mainline'],
  // US cargo — common alongside passenger carriers in T-100 segment filings
  ['5X', 'UPS', 'UPS Airlines', 'US', 'cargo'],
  ['FX', 'FDX', 'FedEx Express', 'US', 'cargo'],
  ['5Y', 'GTI', 'Atlas Air', 'US', 'cargo'],
  ['K4', 'CKS', 'Kalitta Air', 'US', 'cargo'],
  ['M6', 'MEI', 'Amerijet International', 'US', 'cargo'],
  // Additional mainline long-haul carriers on US routes
  ['LX', 'SWR', 'Swiss International Air Lines', 'CH', 'mainline'],
  ['LO', 'LOT', 'LOT Polish Airlines', 'PL', 'mainline'],
  ['TP', 'TAP', 'TAP Air Portugal', 'PT', 'mainline'],
  ['SK', 'SAS', 'SAS Scandinavian Airlines', 'SE', 'mainline'],
  ['EI', 'EIN', 'Aer Lingus', 'IE', 'mainline'],
  ['OS', 'AUA', 'Austrian Airlines', 'AT', 'mainline'],
  ['SN', 'BEL', 'Brussels Airlines', 'BE', 'mainline'],
  ['TK', 'THY', 'Turkish Airlines', 'TR', 'mainline'],
  ['SV', 'SVA', 'Saudia', 'SA', 'mainline'],
  ['ET', 'ETH', 'Ethiopian Airlines', 'ET', 'mainline'],
  ['SA', 'SAA', 'South African Airways', 'ZA', 'mainline'],
  ['GF', 'GFA', 'Gulf Air', 'BH', 'mainline'],
  ['NZ', 'ANZ', 'Air New Zealand', 'NZ', 'mainline'],
  ['QF', 'QFA', 'Qantas', 'AU', 'mainline'],
  ['VA', 'VOZ', 'Virgin Australia', 'AU', 'mainline'],
  ['TN', 'THT', 'Air Tahiti Nui', 'PF', 'mainline'],
  ['FJ', 'FJI', 'Fiji Airways', 'FJ', 'mainline'],
  ['CI', 'CAL', 'China Airlines', 'TW', 'mainline'],
  ['BR', 'EVA', 'EVA Air', 'TW', 'mainline'],
  ['OZ', 'AAR', 'Asiana Airlines', 'KR', 'mainline'],
  ['MU', 'CES', 'China Eastern Airlines', 'CN', 'mainline'],
  ['CZ', 'CSN', 'China Southern Airlines', 'CN', 'mainline'],
  ['HU', 'CHH', 'Hainan Airlines', 'CN', 'mainline'],
  ['PR', 'PAL', 'Philippine Airlines', 'PH', 'mainline'],
  ['TG', 'THA', 'Thai Airways International', 'TH', 'mainline'],
  ['VN', 'HVN', 'Vietnam Airlines', 'VN', 'mainline'],
  ['BA', 'BAW', 'British Airways', 'GB', 'mainline'],
  ['LH', 'DLH', 'Lufthansa', 'DE', 'mainline'],
  ['AF', 'AFR', 'Air France', 'FR', 'mainline'],
  ['KL', 'KLM', 'KLM Royal Dutch Airlines', 'NL', 'mainline'],
  ['IB', 'IBE', 'Iberia', 'ES', 'mainline'],
  ['AZ', 'AZA', 'ITA Airways', 'IT', 'mainline'],
  ['EK', 'UAE', 'Emirates', 'AE', 'mainline'],
  ['QR', 'QTR', 'Qatar Airways', 'QA', 'mainline'],
  ['EY', 'ETD', 'Etihad Airways', 'AE', 'mainline'],
  ['SQ', 'SIA', 'Singapore Airlines', 'SG', 'mainline'],
  ['CX', 'CPA', 'Cathay Pacific', 'HK', 'mainline'],
  ['NH', 'ANA', 'All Nippon Airways', 'JP', 'mainline'],
  ['JL', 'JAL', 'Japan Airlines', 'JP', 'mainline'],
  ['KE', 'KAL', 'Korean Air', 'KR', 'mainline'],
  ['CA', 'CCA', 'Air China', 'CN', 'mainline'],
  ['MH', 'MAS', 'Malaysia Airlines', 'MY', 'mainline'],
];

// ── Aircraft types (~30 common) ───────────────────────────────────────────────
const AIRCRAFT_TYPES: [
  string,
  string,
  string,
  string,
  number,
  number,
  string
][] = [
  // [iata_code, manufacturer, model, family, eco_seats, total_seats, category]
  ['B738', 'Boeing', '737-800', '737NG', 162, 189, 'narrowbody'],
  ['B739', 'Boeing', '737-900', '737NG', 165, 189, 'narrowbody'],
  ['B737', 'Boeing', '737-700', '737NG', 128, 149, 'narrowbody'],
  ['B38M', 'Boeing', '737 MAX 8', '737MAX', 162, 178, 'narrowbody'],
  ['B39M', 'Boeing', '737 MAX 9', '737MAX', 165, 193, 'narrowbody'],
  ['B3XM', 'Boeing', '737 MAX 10', '737MAX', 188, 204, 'narrowbody'],
  ['A319', 'Airbus', 'A319', 'A320family', 128, 144, 'narrowbody'],
  ['A320', 'Airbus', 'A320', 'A320family', 150, 180, 'narrowbody'],
  ['A321', 'Airbus', 'A321', 'A320family', 185, 220, 'narrowbody'],
  ['A20N', 'Airbus', 'A320neo', 'A320neo', 150, 180, 'narrowbody'],
  ['A21N', 'Airbus', 'A321neo', 'A320neo', 182, 220, 'narrowbody'],
  ['A332', 'Airbus', 'A330-200', 'A330', 222, 247, 'widebody'],
  ['A333', 'Airbus', 'A330-300', 'A330', 253, 277, 'widebody'],
  ['A359', 'Airbus', 'A350-900', 'A350', 300, 325, 'widebody'],
  ['A35K', 'Airbus', 'A350-1000', 'A350', 330, 360, 'widebody'],
  ['B763', 'Boeing', '767-300', '767', 198, 218, 'widebody'],
  ['B764', 'Boeing', '767-400', '767', 218, 245, 'widebody'],
  ['B772', 'Boeing', '777-200', '777', 360, 400, 'widebody'],
  ['B77W', 'Boeing', '777-300ER', '777', 365, 396, 'widebody'],
  ['B788', 'Boeing', '787-8', '787', 210, 242, 'widebody'],
  ['B789', 'Boeing', '787-9', '787', 252, 296, 'widebody'],
  ['B78X', 'Boeing', '787-10', '787', 296, 330, 'widebody'],
  ['E170', 'Embraer', 'E170', 'E-jet', 66, 72, 'regional_jet'],
  ['E175', 'Embraer', 'E175', 'E-jet', 70, 78, 'regional_jet'],
  ['E190', 'Embraer', 'E190', 'E-jet', 94, 106, 'regional_jet'],
  ['E75L', 'Embraer', 'E175-E2', 'E-jet E2', 68, 76, 'regional_jet'],
  ['CRJ9', 'Bombardier', 'CRJ900', 'CRJ', 70, 76, 'regional_jet'],
  ['CRJ7', 'Bombardier', 'CRJ700', 'CRJ', 66, 70, 'regional_jet'],
  ['CRJ2', 'Bombardier', 'CRJ200', 'CRJ', 50, 50, 'regional_jet'],
  ['AT75', 'ATR', 'ATR 72-500', 'ATR 72', 66, 70, 'turboprop'],
  ['DH8D', 'De Havilland Canada', 'Dash 8 Q400', 'Dash 8', 72, 78, 'turboprop'],
];

async function seed(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Airports
    logger.info('Seeding airports...');
    for (const [iata, icao, name, city, country, metro] of AIRPORTS) {
      await client.query(
        `INSERT INTO airports (iata_code, icao_code, name, city, country, metro_area)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (iata_code) DO UPDATE SET
           icao_code = EXCLUDED.icao_code,
           name = EXCLUDED.name,
           city = EXCLUDED.city,
           country = EXCLUDED.country,
           metro_area = EXCLUDED.metro_area`,
        [iata, icao, name, city, country, metro]
      );
    }
    logger.info(`Seeded ${AIRPORTS.length} airports`);

    // Carriers
    logger.info('Seeding carriers...');
    for (const [iata, icao, name, country, type] of CARRIERS) {
      await client.query(
        `INSERT INTO carriers (iata_code, icao_code, name, country, carrier_type)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (iata_code) DO UPDATE SET
           icao_code = EXCLUDED.icao_code,
           name = EXCLUDED.name,
           country = EXCLUDED.country,
           carrier_type = EXCLUDED.carrier_type`,
        [iata, icao, name, country, type]
      );
    }
    logger.info(`Seeded ${CARRIERS.length} carriers`);

    // Aircraft types
    logger.info('Seeding aircraft types...');
    for (const [code, mfr, model, family, eco, total, cat] of AIRCRAFT_TYPES) {
      await client.query(
        `INSERT INTO aircraft_types
           (iata_type_code, manufacturer, model, family,
            typical_seats_economy, typical_seats_total, category)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (iata_type_code) DO UPDATE SET
           manufacturer = EXCLUDED.manufacturer,
           model = EXCLUDED.model,
           family = EXCLUDED.family,
           typical_seats_economy = EXCLUDED.typical_seats_economy,
           typical_seats_total = EXCLUDED.typical_seats_total,
           category = EXCLUDED.category`,
        [code, mfr, model, family, eco, total, cat]
      );
    }
    logger.info(`Seeded ${AIRCRAFT_TYPES.length} aircraft types`);

    await client.query('COMMIT');
    logger.info('Seed complete');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await closePool();
  }
}

seed().catch((err) => {
  logger.error('Seed failed', { error: String(err) });
  process.exit(1);
});
