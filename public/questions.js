'use strict';

/* Bo cau hoi - 10 kho bau tuong ung 10 cau hoi */
const QUESTIONS = [
  {
    text: 'Hasaki được thành lập vào thời gian nào và tại đâu?',
    options: [
      '04/2015 tại Hà Nội',
      '04/2016 tại TP.HCM',
      '05/2016 tại Đà Nẵng',
      '04/2018 tại TP.HCM',
    ],
    answer: 1,
  },
  {
    text: 'Hệ thống kênh bán hàng của Hasaki được chia thành mấy nhóm chính?',
    options: [
      '2 nhóm (Cửa hàng trực tiếp, Sàn TMĐT)',
      '3 nhóm (Cửa hàng trực tiếp, Website & App, Sàn TMĐT)',
      '4 nhóm (Cửa hàng trực tiếp, Website, App, Sàn TMĐT)',
      '5 nhóm (Cửa hàng trực tiếp, Website, App, Sàn TMĐT, Livestream)',
    ],
    answer: 1,
  },
  {
    text: 'Quy trình bán hàng của Hasaki (kết hợp O2O và CSR) bao gồm bao nhiêu bước?',
    options: ['4 bước', '5 bước', '6 bước', '7 bước'],
    answer: 2,
  },
  {
    text: 'Theo chính sách lương của Hasaki, mức lương cơ bản của nhân viên mỹ phẩm dao động trong khoảng nào?',
    options: ['6 – 8 triệu đồng/tháng', '8 – 10 triệu đồng/tháng', '10 – 12 triệu đồng/tháng', '12 – 18 triệu đồng/tháng'],
    answer: 1,
  },
  {
    text: 'Trong bảng kết quả KPI thực tế (Dashboard), chỉ tiêu nào sau đây của Hasaki được đánh giá là "Đạt/Tốt" và vượt mục tiêu đề ra?',
    options: ['Doanh số', 'Tỷ lệ chuyển đổi (Conversion Rate)', 'Tỷ lệ khách hàng mua lại', 'Điểm Mystery Shopping'],
    answer: 2,
    note: 'Tỷ lệ khách hàng mua lại đạt 34% – vượt mục tiêu 30%.',
  },
  {
    text: 'Trong kế hoạch phân bổ ngân sách bán hàng 6 tháng cuối năm 2026, hạng mục nào được ưu tiên chiếm tỷ trọng cao nhất (30-35%)?',
    options: [
      'Performance Ads Facebook + Shopee',
      'Voucher + Khuyến mãi',
      'CRM + CSR',
      'TikTok Ads + KOC/KOL Livestream',
    ],
    answer: 3,
  },
  {
    text: 'Đâu KHÔNG PHẢI là một trong 3 vấn đề cốt lõi cần giải quyết được nhóm chỉ ra trong phần đánh giá chung về Hasaki?',
    options: [
      'Lỗ hổng dữ liệu gây rò rỉ thông tin cá nhân',
      'Đạo đức & Kỹ năng tư vấn chưa đồng nhất (tình trạng ép số, chèo kéo)',
      'Tỷ lệ chuyển đổi thấp',
      'Thiếu hụt nguồn vốn đầu tư để mở rộng cửa hàng',
    ],
    answer: 3,
  },
  {
    text: 'Để giải quyết bài toán "Cải thiện tỷ lệ chuyển đổi (Conversion Rate) và giảm tỷ lệ hoàn trả", Hasaki đề xuất giải pháp công nghệ trọng điểm nào?',
    options: [
      'Ứng dụng công nghệ Data Masking (ẩn thông tin) trên toàn bộ vận đơn',
      'Triển khai AI E-learning & Chatbot Role-play để đào tạo nhân viên',
      'Tích hợp AI Recommendation Engine (Hệ thống gợi ý) vào Smart CRM và App',
      'Sử dụng hệ thống ATS để tiếp nhận và sàng lọc hồ sơ',
    ],
    answer: 2,
  },
  {
    text: 'Trong bảng đánh giá trải nghiệm khách hàng (Mystery Shopping), tiêu chí nào nhân viên Hasaki đạt điểm tuyệt đối (15/15)?',
    options: [
      'Nhân viên chào khách chủ động',
      'Nhân viên tìm hiểu nhu cầu',
      'Kiến thức sản phẩm',
      'Tác phong/thái độ',
    ],
    answer: 1,
  },
  {
    text: 'Theo dự báo bán hàng 6 tháng cuối năm 2026, Hasaki dự kiến mở thêm bao nhiêu Experience Store vào Quý 4 và Giá trị đơn hàng trung bình (AOV) dự kiến là bao nhiêu?',
    options: [
      'Thêm 1 cửa hàng, AOV ~300.000đ/đơn',
      'Thêm 2 cửa hàng, AOV ~350.000đ/đơn',
      'Thêm 3 cửa hàng, AOV ~400.000đ/đơn',
      'Thêm 2 cửa hàng, AOV ~500.000đ/đơn',
    ],
    answer: 1,
  },
];
