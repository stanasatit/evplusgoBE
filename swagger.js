const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Firebase Push Notification API',
      version: '1.0.0',
      description: 'Node.js API สำหรับส่ง Push Notification ผ่าน Firebase Cloud Messaging\nTarget app: com.exsample.evplusgo',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local server' }],
    tags: [
      { name: 'Health', description: 'ตรวจสอบสถานะ server' },
      { name: 'User', description: 'สมัครสมาชิก / จัดการผู้ใช้' },
      { name: 'DeviceToken', description: 'จัดการ UUID และ FCM Token ของ device' },
      { name: 'Master - EV Car', description: 'Master ข้อมูลรถ EV' },
      { name: 'Master - Station Status', description: 'Master สถานะตู้บริการ' },
      { name: 'Charging Station', description: 'ข้อมูลสถานีชาร์จ (lat, long)' },
      { name: 'User Vehicle', description: 'รถ EV ของผู้ใช้งาน' },
      { name: 'Booking', description: 'การจองตู้ชาร์จ' },
      { name: 'Pricing Config', description: 'กำหนดอัตราค่าบริการและคำนวณค่าใช้จ่าย' },
      { name: 'Charging Fee', description: 'คำนวณค่าบริการชาร์จ, ประมาณการ และเปรียบเทียบสถานี' },
      { name: 'Charging Session', description: 'ประวัติการชาร์จและค่าบริการแต่ละรอบ' },
      { name: 'Notification', description: 'ส่ง push notification และจัดการ topic' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'ใส่ token จาก POST /user/login → access_token',
        },
      },
      schemas: {
        UserObject: {
          type: 'object',
          properties: {
            id:         { type: 'integer', example: 1 },
            username:   { type: 'string',  example: 'john_doe' },
            birthday:   { type: 'string',  example: '1995-08-21', nullable: true },
            phone:      { type: 'string',  example: '0812345678', nullable: true },
            line_id:    { type: 'string',  example: 'johndoe_line', nullable: true },
            email:        { type: 'string', example: 'john@example.com', nullable: true },
            image_car_url: { type: 'string', example: 'https://example.com/cars/tesla-model3.jpg', nullable: true, description: 'รูปโปรไฟล์ในรูปแบบ Base64' },
            created_at: { type: 'string',  example: '2026-06-21 10:00:00' },
            created_by: { type: 'string',  example: 'john_doe' },
            updated_at: { type: 'string',  example: '2026-06-21 10:00:00' },
            updated_by: { type: 'string',  example: 'john_doe' },
          },
        },
        UserRegisterRequest: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', example: 'john_doe' },
            password: { type: 'string', example: '123456' },
            birthday: { type: 'string', example: '1995-08-21', description: '(optional)' },
            phone:    { type: 'string', example: '0812345678', description: '(optional)' },
            line_id:  { type: 'string', example: 'johndoe_line', description: '(optional)' },
            email:        { type: 'string', example: 'john@example.com', description: '(optional)' },
            image_car_url: { type: 'string', example: 'https://example.com/cars/tesla-model3.jpg', description: 'รูปโปรไฟล์ Base64 (optional)' },
          },
        },
        UserListResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            count:   { type: 'integer', example: 5 },
            users:   { type: 'array', items: { $ref: '#/components/schemas/UserObject' } },
          },
        },
        UserRegisterResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'สมัครสมาชิกสำเร็จ' },
            user:    { $ref: '#/components/schemas/UserObject' },
          },
        },
        SendTokenRequest: {
          type: 'object',
          required: ['token', 'title', 'body'],
          properties: {
            token: { type: 'string', example: 'FCM_DEVICE_TOKEN', description: 'FCM device token' },
            title: { type: 'string', example: 'แจ้งเตือน', description: 'หัวข้อ notification' },
            body: { type: 'string', example: 'มีข้อความใหม่', description: 'เนื้อหา notification' },
            imageUrl: { type: 'string', example: 'https://example.com/image.png', description: 'URL รูปภาพ (optional)' },
            data: {
              type: 'object',
              example: { screen: 'home', id: '123' },
              description: 'ข้อมูล custom payload (optional)',
            },
          },
        },
        SendTopicRequest: {
          type: 'object',
          required: ['topic', 'title', 'body'],
          properties: {
            topic: { type: 'string', example: 'news', description: 'ชื่อ topic' },
            title: { type: 'string', example: 'ประกาศ', description: 'หัวข้อ notification' },
            body: { type: 'string', example: 'ข้อความถึงทุกคน', description: 'เนื้อหา notification' },
            imageUrl: { type: 'string', example: 'https://example.com/image.png', description: 'URL รูปภาพ (optional)' },
            data: { type: 'object', example: { screen: 'news' }, description: 'ข้อมูล custom payload (optional)' },
          },
        },
        SendMultipleRequest: {
          type: 'object',
          required: ['tokens', 'title', 'body'],
          properties: {
            tokens: {
              type: 'array',
              items: { type: 'string' },
              example: ['TOKEN_1', 'TOKEN_2'],
              description: 'รายการ FCM device tokens',
            },
            title: { type: 'string', example: 'ประกาศ', description: 'หัวข้อ notification' },
            body: { type: 'string', example: 'ข้อความถึงทุกคน', description: 'เนื้อหา notification' },
            imageUrl: { type: 'string', example: 'https://example.com/image.png', description: 'URL รูปภาพ (optional)' },
            data: { type: 'object', example: { screen: 'home' }, description: 'ข้อมูล custom payload (optional)' },
          },
        },
        TopicRequest: {
          type: 'object',
          required: ['tokens', 'topic'],
          properties: {
            tokens: {
              type: 'array',
              items: { type: 'string' },
              example: ['TOKEN_1', 'TOKEN_2'],
              description: 'รายการ FCM device tokens',
            },
            topic: { type: 'string', example: 'news', description: 'ชื่อ topic' },
          },
        },
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            messageId: { type: 'string', example: 'projects/evpluggo/messages/12345' },
          },
        },
        MultipleResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            successCount: { type: 'integer', example: 2 },
            failureCount: { type: 'integer', example: 0 },
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  token: { type: 'string' },
                  success: { type: 'boolean' },
                  messageId: { type: 'string' },
                  error: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        TopicResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            successCount: { type: 'integer', example: 2 },
            failureCount: { type: 'integer', example: 0 },
            errors: { type: 'array', items: { type: 'object' } },
          },
        },
        DeviceTokenResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'บันทึก FCM Token สำเร็จ' },
            data: {
              type: 'object',
              properties: {
                id: { type: 'integer', example: 1 },
                uuid: { type: 'string', example: '550e8400-e29b-41d4-a716-446655440000' },
                fcm_token: { type: 'string', example: 'FCM_TOKEN_HERE' },
                user_id: { type: 'integer', example: 1, nullable: true },
                platform: { type: 'string', example: 'android', nullable: true },
                created_at: { type: 'string', example: '2026-06-21 10:00:00' },
                created_by: { type: 'string', example: 'john_doe' },
                updated_at: { type: 'string', example: '2026-06-21 10:00:00' },
                updated_by: { type: 'string', example: 'john_doe' },
              },
            },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'token is required' },
            code: { type: 'string', example: 'messaging/invalid-argument' },
          },
        },
      },
    },
  },
  apis: ['./routes/*.js', './index.js'],
};

module.exports = swaggerJsdoc(options);
