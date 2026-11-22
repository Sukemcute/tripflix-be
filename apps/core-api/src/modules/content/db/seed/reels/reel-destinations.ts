/**
 * Điểm đến của reel mẫu: lấy khách sạn ở tỉnh nào trong catalog commerce và bay tới sân bay nào.
 * keywords lọc thêm theo tên, thành phố, địa chỉ khách sạn khi tỉnh gộp nhiều vùng (Hà Giang nằm trong Tuyên Quang...).
 * transfer: chặng xe từ sân bay tới nơi, không đặt được trên app.
 */
export interface ReelDestination {
  key: string;
  name: string;
  provinceSlugs: string[];
  keywords?: string[];
  airport: string;
  transfer?: { from: string; mode: 'bus' | 'car' | 'train' | 'other'; minutes: number; note: string };
  hashtags: string[];
}

export const REEL_DESTINATIONS: ReelDestination[] = [
  { key: 'da-lat', name: 'Đà Lạt', provinceSlugs: ['da-lat'], airport: 'DLI', hashtags: ['dalat', 'lamdong'] },
  { key: 'hoi-an', name: 'Hội An', provinceSlugs: ['hoi-an'], airport: 'DAD', transfer: { from: 'Đà Nẵng', mode: 'car', minutes: 45, note: 'Taxi khoảng 45 phút từ sân bay' }, hashtags: ['hoian', 'phocohoian'] },
  { key: 'phu-quoc', name: 'Phú Quốc', provinceSlugs: ['phu-quoc'], airport: 'PQC', hashtags: ['phuquoc', 'daongoc'] },
  { key: 'ha-giang', name: 'Hà Giang', provinceSlugs: ['tuyen-quang'], keywords: ['Hà Giang', 'Đồng Văn', 'Mèo Vạc'], airport: 'HAN', transfer: { from: 'Hà Nội', mode: 'bus', minutes: 360, note: 'Xe giường nằm đêm khoảng 6 tiếng' }, hashtags: ['hagiang', 'cungduonghanhphuc'] },
  { key: 'sa-pa', name: 'Sa Pa', provinceSlugs: ['lao-cai'], keywords: ['Sa Pa', 'Sapa'], airport: 'HAN', transfer: { from: 'Hà Nội', mode: 'bus', minutes: 300, note: 'Xe limousine cao tốc khoảng 5 tiếng' }, hashtags: ['sapa', 'laocai'] },
  { key: 'ha-long', name: 'Hạ Long', provinceSlugs: ['ha-long'], airport: 'VDO', transfer: { from: 'Vân Đồn', mode: 'car', minutes: 50, note: 'Xe trung chuyển khoảng 50 phút' }, hashtags: ['halong', 'vinhhalong'] },
  { key: 'ninh-binh', name: 'Ninh Bình', provinceSlugs: ['ninh-binh'], airport: 'HAN', transfer: { from: 'Hà Nội', mode: 'car', minutes: 105, note: 'Xe limousine khoảng 1 tiếng 45 phút' }, hashtags: ['ninhbinh', 'trangan'] },
  { key: 'hue', name: 'Huế', provinceSlugs: ['hue'], airport: 'HUI', hashtags: ['hue', 'codohue'] },
  { key: 'nha-trang', name: 'Nha Trang', provinceSlugs: ['nha-trang'], airport: 'CXR', hashtags: ['nhatrang', 'khanhhoa'] },
  { key: 'da-nang', name: 'Đà Nẵng', provinceSlugs: ['da-nang'], airport: 'DAD', hashtags: ['danang', 'thanhphodangsong'] },
  { key: 'moc-chau', name: 'Mộc Châu', provinceSlugs: ['son-la'], keywords: ['Mộc Châu'], airport: 'HAN', transfer: { from: 'Hà Nội', mode: 'bus', minutes: 240, note: 'Xe khách khoảng 4 tiếng' }, hashtags: ['mocchau', 'sonla'] },
  { key: 'cao-bang', name: 'Cao Bằng', provinceSlugs: ['cao-bang'], airport: 'HAN', transfer: { from: 'Hà Nội', mode: 'bus', minutes: 420, note: 'Xe giường nằm khoảng 7 tiếng' }, hashtags: ['caobang', 'thacbangioc'] },
  { key: 'quy-nhon', name: 'Quy Nhơn', provinceSlugs: ['quy-nhon'], airport: 'UIH', hashtags: ['quynhon', 'kyco'] },
  { key: 'phu-yen', name: 'Phú Yên', provinceSlugs: ['dak-lak'], keywords: ['Tuy Hòa'], airport: 'TBB', hashtags: ['phuyen', 'tuyhoa'] },
  { key: 'con-dao', name: 'Côn Đảo', provinceSlugs: ['con-dao'], airport: 'VCS', hashtags: ['condao', 'biendao'] },
  { key: 'can-tho', name: 'Cần Thơ', provinceSlugs: ['can-tho'], airport: 'VCA', hashtags: ['cantho', 'mientay'] },
  { key: 'tam-dao', name: 'Tam Đảo', provinceSlugs: ['phu-tho'], keywords: ['Tam Đảo'], airport: 'HAN', transfer: { from: 'Hà Nội', mode: 'car', minutes: 120, note: 'Tự lái khoảng 2 tiếng' }, hashtags: ['tamdao', 'vinhphuc'] },
  { key: 'mu-cang-chai', name: 'Mù Cang Chải', provinceSlugs: ['lao-cai'], keywords: ['Mù Cang Chải'], airport: 'HAN', transfer: { from: 'Hà Nội', mode: 'bus', minutes: 420, note: 'Xe giường nằm khoảng 7 tiếng' }, hashtags: ['mucangchai', 'ruongbacthang'] },
  { key: 'ly-son', name: 'Lý Sơn', provinceSlugs: ['quang-ngai'], keywords: ['Lý Sơn'], airport: 'VCL', transfer: { from: 'Sa Kỳ', mode: 'other', minutes: 90, note: 'Tàu cao tốc ra đảo khoảng 30 phút' }, hashtags: ['lyson', 'quangngai'] },
  { key: 'vung-tau', name: 'Vũng Tàu', provinceSlugs: ['vung-tau'], airport: 'SGN', transfer: { from: 'TP.HCM', mode: 'car', minutes: 90, note: 'Đi cao tốc khoảng 1 tiếng 30 phút' }, hashtags: ['vungtau', 'biengan'] },
  { key: 'cat-ba', name: 'Cát Bà', provinceSlugs: ['hai-phong'], keywords: ['Cát Bà'], airport: 'HPH', transfer: { from: 'Hải Phòng', mode: 'other', minutes: 90, note: 'Xe và phà ra đảo khoảng 1 tiếng 30 phút' }, hashtags: ['catba', 'lanha'] },
  { key: 'buon-ma-thuot', name: 'Buôn Ma Thuột', provinceSlugs: ['dak-lak'], keywords: ['Buôn Ma Thuột'], airport: 'BMV', hashtags: ['buonmathuot', 'taynguyen'] },
  { key: 'an-giang', name: 'An Giang', provinceSlugs: ['an-giang'], airport: 'VCA', transfer: { from: 'Cần Thơ', mode: 'bus', minutes: 180, note: 'Xe khách khoảng 3 tiếng' }, hashtags: ['angiang', 'chaudoc'] },
  { key: 'phan-thiet', name: 'Phan Thiết', provinceSlugs: ['lam-dong'], keywords: ['Phan Thiết', 'Mũi Né'], airport: 'SGN', transfer: { from: 'TP.HCM', mode: 'car', minutes: 150, note: 'Cao tốc khoảng 2 tiếng 30 phút' }, hashtags: ['phanthiet', 'muine'] },
  { key: 'ha-noi', name: 'Hà Nội', provinceSlugs: ['ha-noi'], airport: 'HAN', hashtags: ['hanoi', 'phocohanoi'] },
  { key: 'sai-gon', name: 'Sài Gòn', provinceSlugs: ['sai-gon', 'ho-chi-minh'], airport: 'SGN', hashtags: ['saigon', 'tphcm'] },
  { key: 'ca-mau', name: 'Cà Mau', provinceSlugs: ['ca-mau'], airport: 'CAH', hashtags: ['camau', 'datmui'] },
];
