/** Sân bay có trong dữ liệu chuyến bay của commerce. placeId là nút gần nhất trong PLACES để ghi phụ đề. */
export interface AirportSeed {
  code: string;
  name: string;
  placeId: string;
}

export const AIRPORTS: readonly AirportSeed[] = [
  { code: 'HAN', name: 'Sân bay Nội Bài', placeId: 'ha-noi' },
  { code: 'SGN', name: 'Sân bay Tân Sơn Nhất', placeId: 'ho-chi-minh' },
  { code: 'DAD', name: 'Sân bay Đà Nẵng', placeId: 'da-nang' },
  { code: 'CXR', name: 'Sân bay Cam Ranh', placeId: 'nha-trang' },
  { code: 'PQC', name: 'Sân bay Phú Quốc', placeId: 'phu-quoc' },
  { code: 'DLI', name: 'Sân bay Liên Khương', placeId: 'da-lat' },
  { code: 'HPH', name: 'Sân bay Cát Bi', placeId: 'hai-phong' },
  { code: 'HUI', name: 'Sân bay Phú Bài', placeId: 'hue' },
  { code: 'VDO', name: 'Sân bay Vân Đồn', placeId: 'ha-long' },
  { code: 'UIH', name: 'Sân bay Phù Cát', placeId: 'quy-nhon' },
  { code: 'VCS', name: 'Sân bay Côn Đảo', placeId: 'con-dao' },
  { code: 'VCA', name: 'Sân bay Cần Thơ', placeId: 'can-tho' },
  { code: 'BMV', name: 'Sân bay Buôn Ma Thuột', placeId: 'dak-lak' },
  { code: 'PXU', name: 'Sân bay Pleiku', placeId: 'gia-lai' },
  { code: 'VII', name: 'Sân bay Vinh', placeId: 'nghe-an' },
  { code: 'THD', name: 'Sân bay Thọ Xuân', placeId: 'thanh-hoa' },
  { code: 'VDH', name: 'Sân bay Đồng Hới', placeId: 'quang-tri' },
  { code: 'VCL', name: 'Sân bay Chu Lai', placeId: 'quang-ngai' },
  { code: 'DIN', name: 'Sân bay Điện Biên', placeId: 'dien-bien' },
  { code: 'CAH', name: 'Sân bay Cà Mau', placeId: 'ca-mau' },
  { code: 'TBB', name: 'Sân bay Tuy Hòa', placeId: 'dak-lak' },
  { code: 'VKG', name: 'Sân bay Rạch Giá', placeId: 'an-giang' },
];
